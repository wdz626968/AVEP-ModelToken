import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/**
 * POST /api/admin/stale-tasks — Auto-failover for stuck tasks
 *
 * Designed to run as a cron job (Vercel Cron or external).
 * Detects tasks where the assigned worker has gone silent and either:
 *   1. Re-queues the task to "pending" (for auto-match pickup)
 *   2. Finds a replacement worker immediately
 *
 * Stale criteria:
 *   - Task status is "accepted" (in progress)
 *   - Worker hasn't sent a heartbeat in {staleMinutes} minutes
 *   - No checkpoint activity in {staleMinutes} minutes
 *
 * Authorization: Requires CRON_SECRET header for security.
 */
export async function POST(request: NextRequest) {
  // Verify cron secret (or skip in dev)
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authHeader = request.headers.get("authorization");
    if (authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const body = await request.json().catch(() => ({}));
  const staleMinutes = (body as Record<string, unknown>).staleMinutes as number || 15;
  const autoRequeue = (body as Record<string, unknown>).autoRequeue !== false;

  const cutoff = new Date(Date.now() - staleMinutes * 60 * 1000);

  // Find accepted tasks with stale workers
  const staleTasks = await prisma.task.findMany({
    where: {
      status: "accepted",
      workerId: { not: null },
      worker: {
        OR: [
          { lastHeartbeat: { lt: cutoff } },
          { lastHeartbeat: null },
        ],
      },
    },
    include: {
      worker: { select: { id: true, name: true, lastHeartbeat: true } },
      room: { select: { id: true } },
      workerAssignments: {
        where: { status: "active" },
      },
    },
    take: 20,
  });

  const results = [];

  for (const task of staleTasks) {
    // Check if there's been recent checkpoint activity
    if (task.room) {
      const recentCheckpoint = await prisma.checkpoint.findFirst({
        where: {
          roomId: task.room.id,
          createdAt: { gt: cutoff },
        },
      });
      if (recentCheckpoint) {
        // Worker is making progress even without heartbeat, skip
        results.push({
          taskId: task.id,
          action: "skipped",
          reason: "Recent checkpoint activity",
        });
        continue;
      }
    }

    if (autoRequeue) {
      // Mark current assignment as failed
      await prisma.$transaction(async (tx) => {
        // End active assignments
        await tx.workerAssignment.updateMany({
          where: { taskId: task.id, status: "active" },
          data: {
            status: "failed",
            endedAt: new Date(),
            reason: "worker_stale_auto_failover",
          },
        });

        // Re-queue task to pending for auto-match pickup
        await tx.task.update({
          where: { id: task.id },
          data: {
            status: "pending",
            workerId: null,
          },
        });

        // Add system message to room
        if (task.room) {
          await tx.roomMessage.create({
            data: {
              roomId: task.room.id,
              senderId: task.publisherId,
              type: "system",
              content: JSON.stringify({
                event: "worker_auto_failover",
                previousWorkerId: task.workerId,
                previousWorkerName: task.worker?.name,
                reason: `Worker heartbeat stale for ${staleMinutes}+ minutes`,
                action: "task_requeued",
              }),
            },
          });
        }
      });

      results.push({
        taskId: task.id,
        title: task.title,
        action: "requeued",
        previousWorker: task.worker?.name,
        lastHeartbeat: task.worker?.lastHeartbeat,
      });
    } else {
      results.push({
        taskId: task.id,
        title: task.title,
        action: "detected",
        previousWorker: task.worker?.name,
        lastHeartbeat: task.worker?.lastHeartbeat,
      });
    }
  }

  return NextResponse.json({
    processed: results.length,
    staleMinutes,
    autoRequeue,
    results,
  });
}

/**
 * GET /api/admin/stale-tasks — List currently stale tasks (read-only)
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const staleMinutes = parseInt(searchParams.get("staleMinutes") || "15");
  const cutoff = new Date(Date.now() - staleMinutes * 60 * 1000);

  const staleTasks = await prisma.task.findMany({
    where: {
      status: "accepted",
      workerId: { not: null },
      worker: {
        OR: [
          { lastHeartbeat: { lt: cutoff } },
          { lastHeartbeat: null },
        ],
      },
    },
    select: {
      id: true,
      title: true,
      status: true,
      createdAt: true,
      worker: { select: { id: true, name: true, lastHeartbeat: true } },
    },
    take: 50,
  });

  return NextResponse.json({
    staleTasks,
    total: staleTasks.length,
    staleMinutes,
  });
}
