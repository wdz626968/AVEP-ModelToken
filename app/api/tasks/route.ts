import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticateDrone, unauthorizedResponse } from "@/lib/auth";
import { findBestWorker, generateMatchHint, MatchPreference } from "@/lib/matching";

export async function POST(request: NextRequest) {
  const auth = await authenticateDrone(request);
  if (!auth) return unauthorizedResponse();

  try {
    const body = await request.json();
    const {
      title,
      description,
      publicPayload,
      estimatedTokens,
      priority = "medium",
      category,
      matchPreference,
    } = body;

    if (!title || !description || !estimatedTokens) {
      return NextResponse.json(
        { error: "title, description, and estimatedTokens are required" },
        { status: 400 }
      );
    }
    if (estimatedTokens <= 0 || estimatedTokens > 10000) {
      return NextResponse.json(
        { error: "estimatedTokens must be between 1 and 10000" },
        { status: 400 }
      );
    }
    if (auth.drone.nectar < estimatedTokens) {
      return NextResponse.json(
        { error: "Insufficient Nectar", have: auth.drone.nectar, need: estimatedTokens },
        { status: 402 }
      );
    }

    const taskContext = {
      category: category || null,
      priority: priority as "high" | "medium" | "low",
      estimatedTokens,
      publisherId: auth.drone.id,
      preference: matchPreference as MatchPreference | undefined,
    };

    const bestMatch = await findBestWorker(taskContext);

    // ── Case 1: No available Worker ──────────────────────────────────────────
    if (!bestMatch) {
      const matchHint = await generateMatchHint(
        auth.drone.id,
        category || null,
        estimatedTokens
      );

      const result = await prisma.$transaction(async (tx) => {
        const freshDrone = await tx.drone.findUniqueOrThrow({ where: { id: auth.drone.id } });
        if (freshDrone.nectar < estimatedTokens) throw new Error("INSUFFICIENT_NECTAR");

        const task = await tx.task.create({
          data: {
            title, description,
            publicPayload: publicPayload ? JSON.stringify(publicPayload) : null,
            estimatedTokens, lockedNectar: estimatedTokens,
            priority, category: category || null,
            status: "pending", publisherId: auth.drone.id,
          },
        });

        const newBalance = freshDrone.nectar - estimatedTokens;
        await tx.drone.update({
          where: { id: auth.drone.id },
          data: { nectar: newBalance, totalSpent: { increment: estimatedTokens }, tasksPublished: { increment: 1 } },
        });
        await tx.nectarLedger.create({
          data: {
            droneId: auth.drone.id, taskId: task.id,
            type: "lock", amount: -estimatedTokens, balanceAfter: newBalance,
            description: `Locked ${estimatedTokens} Nectar for task`,
          },
        });
        return { task, remainingNectar: newBalance };
      });

      return NextResponse.json({
        taskId: result.task.id,
        status: "pending",
        roomId: null,
        worker: null,
        lockedNectar: estimatedTokens,
        remainingNectar: result.remainingNectar,
        matchHint,
        note: "Task published but no available Worker found. Check matchHint.suggestedPollIntervalMs for polling frequency.",
      }, { status: 201 });
    }

    // ── Case 2: Worker found — create task + room + Nectar lock atomically ───
    const { worker: bestWorker, matchScore, breakdown, candidateCount } = bestMatch;

    const result = await prisma.$transaction(async (tx) => {
      const freshDrone = await tx.drone.findUniqueOrThrow({ where: { id: auth.drone.id } });
      if (freshDrone.nectar < estimatedTokens) throw new Error("INSUFFICIENT_NECTAR");

      const task = await tx.task.create({
        data: {
          title, description,
          publicPayload: publicPayload ? JSON.stringify(publicPayload) : null,
          estimatedTokens, lockedNectar: estimatedTokens,
          priority, category: category || null,
          status: "accepted", publisherId: auth.drone.id,
          workerId: bestWorker.id, acceptedAt: new Date(),
        },
      });

      const room = await tx.room.create({
        data: { taskId: task.id, mode: "centralized", status: "active" },
      });

      await tx.workerAssignment.create({
        data: { taskId: task.id, workerId: bestWorker.id, status: "active" },
      });

      // v2: embed matchSnapshot in system message for full observability
      await tx.roomMessage.create({
        data: {
          roomId: room.id,
          senderId: auth.drone.id,
          type: "system",
          content: JSON.stringify({
            event: "worker_assigned",
            workerId: bestWorker.id,
            workerName: bestWorker.name,
            mode: "centralized",
            autoAssigned: true,
            matchSnapshot: {
              matchScore,
              candidateCount,
              scoreBreakdown: breakdown,
              heartbeatAgeMs: bestWorker.lastHeartbeat
                ? Date.now() - bestWorker.lastHeartbeat.getTime()
                : null,
            },
          }),
        },
      });

      const newBalance = freshDrone.nectar - estimatedTokens;
      await tx.drone.update({
        where: { id: auth.drone.id },
        data: { nectar: newBalance, totalSpent: { increment: estimatedTokens }, tasksPublished: { increment: 1 } },
      });
      await tx.nectarLedger.create({
        data: {
          droneId: auth.drone.id, taskId: task.id,
          type: "lock", amount: -estimatedTokens, balanceAfter: newBalance,
          description: `Locked ${estimatedTokens} Nectar for task`,
        },
      });

      return { task, room, remainingNectar: newBalance };
    });

    // Structured log for production diagnostics
    console.log(JSON.stringify({
      event: "match_decision",
      taskId: result.task.id,
      priority: taskContext.priority,
      category: taskContext.category,
      estimatedTokens,
      candidateCount,
      selected: {
        workerId: bestWorker.id,
        matchScore,
        scoreBreakdown: breakdown,
        heartbeatAgeMs: bestWorker.lastHeartbeat
          ? Date.now() - bestWorker.lastHeartbeat.getTime()
          : null,
      },
      ts: new Date().toISOString(),
    }));

    return NextResponse.json({
      taskId: result.task.id,
      status: "accepted",
      roomId: result.room.id,
      worker: {
        id: bestWorker.id,
        name: bestWorker.name,
        did: bestWorker.did,
        matchScore,
        matchReason: {
          candidateCount,
          scoreBreakdown: breakdown,
        },
      },
      lockedNectar: estimatedTokens,
      remainingNectar: result.remainingNectar,
      note: "Task published and Worker auto-assigned. Send task_payload to the Room via POST /api/rooms/:roomId/messages.",
    }, { status: 201 });

  } catch (error) {
    if (error instanceof Error && error.message === "INSUFFICIENT_NECTAR") {
      return NextResponse.json({ error: "Insufficient Nectar" }, { status: 402 });
    }
    console.error("Publish task error:", error);
    return NextResponse.json(
      { error: "Internal server error", detail: String(error) },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status");
  const category = searchParams.get("category");
  const limit = Math.min(parseInt(searchParams.get("limit") || "20"), 100);
  const cursor = searchParams.get("cursor");
  const excludeExpired = searchParams.get("excludeExpired") !== "false";

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: Record<string, any> = {};
  if (status) where.status = status;
  if (category) where.category = category;

  if (excludeExpired && (!status || status === "pending")) {
    const expiryCutoff = new Date(Date.now() - 4 * 60 * 60 * 1000);
    if (status === "pending") {
      where.createdAt = { gte: expiryCutoff };
    } else if (!status) {
      where.OR = [
        { status: { not: "pending" } },
        { status: "pending", createdAt: { gte: expiryCutoff } },
      ];
    }
  }

  const tasks = await prisma.task.findMany({
    where,
    select: {
      id: true, title: true, description: true, publicPayload: true,
      estimatedTokens: true, lockedNectar: true, priority: true,
      category: true, status: true, publisherId: true, workerId: true,
      createdAt: true,
      publisher: { select: { id: true, name: true, did: true } },
    },
    orderBy: [{ priority: "desc" }, { createdAt: "desc" }],
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });

  const hasNext = tasks.length > limit;
  const items = hasNext ? tasks.slice(0, limit) : tasks;

  return NextResponse.json({
    tasks: items.map((t) => ({
      ...t,
      publicPayload: t.publicPayload ? JSON.parse(t.publicPayload) : null,
    })),
    nextCursor: hasNext ? items[items.length - 1].id : null,
    total: items.length,
  });
}
