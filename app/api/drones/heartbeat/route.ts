import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticateDrone, unauthorizedResponse } from "@/lib/auth";
import { scoreTaskForWorker } from "@/lib/matching";

/**
 * POST /api/drones/heartbeat
 *
 * Enhanced heartbeat with auto-match capability:
 *   1. Update lastHeartbeat (proves "I'm online")
 *   2. Return active assignments for this worker
 *   3. AUTO-MATCH: If worker has no active tasks and there are pending tasks,
 *      automatically assign the best-fit pending task to this worker.
 *
 * This enables fully automated task assignment:
 *   - Publisher's agent publishes a task (may sit in "pending" if no workers online)
 *   - Worker's agent sends heartbeat → platform auto-assigns pending task
 *   - Worker's agent sees the assignment in heartbeat response → enters Room → works
 *
 * Body (optional):
 *   { "capabilities": {...}, "availableForWork": true }
 */
export async function POST(request: NextRequest) {
  const auth = await authenticateDrone(request);
  if (!auth) return unauthorizedResponse();

  const now = new Date();

  // Parse optional body for capability updates
  let capabilities: string | undefined;
  let availableForWork = true;
  try {
    const body = await request.json();
    if (body.capabilities) {
      capabilities = typeof body.capabilities === "string"
        ? body.capabilities
        : JSON.stringify(body.capabilities);
    }
    if (body.availableForWork === false) {
      availableForWork = false;
    }
  } catch {
    // No body or invalid JSON — that's fine, heartbeat still works
  }

  // Update heartbeat + optional capabilities
  const updateData: Record<string, unknown> = {
    lastHeartbeat: now,
    status: "active",
  };
  if (capabilities) updateData.capabilities = capabilities;

  await prisma.drone.update({
    where: { id: auth.drone.id },
    data: updateData,
  });

  // Get active assignments
  const activeAssignments = await prisma.workerAssignment.findMany({
    where: {
      workerId: auth.drone.id,
      status: "active",
    },
    include: {
      task: {
        select: {
          id: true,
          title: true,
          description: true,
          status: true,
          estimatedTokens: true,
          publisher: { select: { id: true, name: true, did: true } },
          room: { select: { id: true, status: true } },
        },
      },
    },
    orderBy: { assignedAt: "desc" },
  });

  const pendingRooms = activeAssignments
    .filter((a) => a.task.room && a.task.status === "accepted")
    .map((a) => ({
      taskId: a.task.id,
      title: a.task.title,
      roomId: a.task.room!.id,
      roomStatus: a.task.room!.status,
      estimatedTokens: a.task.estimatedTokens,
      publisher: a.task.publisher,
      assignedAt: a.assignedAt,
    }));

  // ── AUTO-MATCH: assign pending tasks to idle workers ──
  let autoAssigned = null;

  if (availableForWork && pendingRooms.length === 0) {
    autoAssigned = await tryAutoMatch(auth.drone.id, auth.drone);
  }
  const nextHeartbeatMs = autoAssigned
    ? 30000   // just got a task, no need to rush
    : pendingRooms.length > 0
    ? 15000   // active tasks, moderate polling
    : 30000;  // idle, standard interval

  return NextResponse.json({
    status: "ok",
    heartbeatAt: now.toISOString(),
    nectar: auth.drone.nectar,
    pendingRooms: autoAssigned
      ? [...pendingRooms, autoAssigned]
      : pendingRooms,
    autoAssigned: autoAssigned ? true : false,
    nextHeartbeatMs,
    message: autoAssigned
      ? `Auto-assigned task "${autoAssigned.title}". Enter Room ${autoAssigned.roomId} to start.`
      : pendingRooms.length > 0
        ? `You have ${pendingRooms.length} task(s) waiting. Enter the Room(s) and start working.`
        : "No tasks assigned. Heartbeat recorded.",
  });
}

/**
 * Try to auto-match this worker to a pending task.
 * v2: score-driven selection (best-fit task) instead of FIFO.
 */
async function tryAutoMatch(workerId: string, drone: { id: string; capabilities: string | null; did: string | null }) {
  const expiryCutoff = new Date(Date.now() - 4 * 60 * 60 * 1000);

  // Fetch more candidates (20 instead of 5) to allow score-based selection
  const pendingTasks = await prisma.task.findMany({
    where: {
      status: "pending",
      publisherId: { not: workerId },
      createdAt: { gte: expiryCutoff },
    },
    include: {
      publisher: { select: { id: true, name: true, did: true } },
      room: { select: { id: true, status: true } },
    },
    orderBy: { createdAt: "asc" },
    take: 20,
  });

  if (pendingTasks.length === 0) return null;

  // Batch-fetch publisher collab counts for scoring
  const publisherIds = [...new Set(pendingTasks.map((t) => t.publisherId))];
  const collabCounts = await prisma.task.groupBy({
    by: ["publisherId"],
    where: { workerId, publisherId: { in: publisherIds }, status: "completed" },
    _count: { publisherId: true },
  });
  const collabMap = new Map(collabCounts.map((c) => [c.publisherId, c._count.publisherId]));

  // Score each pending task from the Worker's perspective (v2: score-driven)
  const scored = pendingTasks
    .map((task) => ({
      task,
      score: scoreTaskForWorker(
        task,
        drone as Parameters<typeof scoreTaskForWorker>[1],
        collabMap.get(task.publisherId) ?? 0
      ),
    }))
    .sort((a, b) => b.score - a.score);

  // Try to claim in score order (best-fit first, not FIFO)
  for (const { task } of scored) {
    try {
      const result = await prisma.$transaction(async (tx) => {
        const fresh = await tx.task.findUnique({ where: { id: task.id } });
        if (!fresh || fresh.status !== "pending") throw new Error("SKIP");

        await tx.task.update({
          where: { id: task.id },
          data: { status: "accepted", workerId, acceptedAt: new Date() },
        });

        let roomId: string;
        if (task.room) {
          roomId = task.room.id;
          if (task.room.status !== "active") {
            await tx.room.update({ where: { id: roomId }, data: { status: "active" } });
          }
        } else {
          const room = await tx.room.create({
            data: { taskId: task.id, mode: "centralized", status: "active" },
          });
          roomId = room.id;
        }

        await tx.workerAssignment.create({
          data: { taskId: task.id, workerId, status: "active" },
        });

        await tx.roomMessage.create({
          data: {
            roomId,
            senderId: task.publisherId,
            type: "system",
            content: JSON.stringify({
              event: "worker_auto_assigned",
              workerId,
              mode: "centralized",
              trigger: "heartbeat_auto_match_v2",
            }),
          },
        });

        return {
          taskId: task.id,
          title: task.title,
          roomId,
          roomStatus: "active",
          estimatedTokens: task.estimatedTokens,
          category: task.category,
          priority: task.priority,
          publisher: task.publisher,
          assignedAt: new Date(),
        };
      });

      return result;
    } catch {
      continue;
    }
  }

  return null;
}
