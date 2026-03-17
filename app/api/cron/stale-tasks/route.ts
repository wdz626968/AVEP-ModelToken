import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * GET /api/cron/stale-tasks — Vercel Cron: auto-failover for stuck tasks
 *
 * Runs every 5 minutes via Vercel Cron.
 * Detects accepted tasks where the worker has gone silent (no heartbeat in 15 min)
 * and re-queues them to "pending" for auto-match pickup on next worker heartbeat.
 *
 * Authorization: Vercel Cron sets CRON_SECRET automatically.
 */
export async function GET(request: NextRequest) {
  // Verify Vercel Cron secret
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authHeader = request.headers.get("authorization");
    if (authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const staleMinutes = 15;
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
    },
    take: 20,
  });

  const results = [];

  for (const task of staleTasks) {
    // Check for recent checkpoint activity (worker might be working without heartbeat)
    if (task.room) {
      const recentCheckpoint = await prisma.checkpoint.findFirst({
        where: {
          roomId: task.room.id,
          createdAt: { gt: cutoff },
        },
      });
      if (recentCheckpoint) {
        results.push({ taskId: task.id, action: "skipped", reason: "recent_checkpoint" });
        continue;
      }
    }

    // Re-queue the task
    await prisma.$transaction(async (tx) => {
      await tx.workerAssignment.updateMany({
        where: { taskId: task.id, status: "active" },
        data: {
          status: "failed",
          endedAt: new Date(),
          reason: "worker_stale_auto_failover",
        },
      });

      await tx.task.update({
        where: { id: task.id },
        data: { status: "pending", workerId: null },
      });

      if (task.room) {
        await tx.roomMessage.create({
          data: {
            roomId: task.room.id,
            senderId: task.publisherId,
            type: "system",
            content: JSON.stringify({
              event: "worker_auto_failover",
              previousWorkerId: task.workerId,
              reason: `Heartbeat stale ${staleMinutes}+ min`,
            }),
          },
        });
      }
    });

    results.push({
      taskId: task.id,
      action: "requeued",
      previousWorker: task.worker?.name,
    });
  }

  return NextResponse.json({
    ok: true,
    processed: results.length,
    results,
    timestamp: new Date().toISOString(),
  });
}
