import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendAnpMessage } from "@/lib/anp";

export const dynamic = "force-dynamic";

/**
 * GET /api/cron/stale-tasks — Vercel Cron: 两类自动处理
 *
 * 1. 离线 Worker 失联任务：Worker 心跳超过 15 分钟无响应，重置为 pending
 * 2. 超时待确认任务：Worker 已提交结果，但 Publisher 超过 settleDeadline 未确认
 *    → 平台自动以满分结算，保护 Worker 利益
 *
 * 每 5 分钟由 Vercel Cron 调用。
 */
export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authHeader = request.headers.get("authorization");
    if (authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const results: unknown[] = [];

  // ── 1. 离线 Worker 失联任务 ───────────────────────────────────────────────
  const staleMinutes = 15;
  const staleCutoff = new Date(Date.now() - staleMinutes * 60 * 1000);

  const staleTasks = await prisma.task.findMany({
    where: {
      status: "accepted",
      workerId: { not: null },
      worker: {
        OR: [
          { lastHeartbeat: { lt: staleCutoff } },
          { lastHeartbeat: null },
        ],
      },
    },
    include: {
      worker: { select: { id: true, name: true, lastHeartbeat: true, did: true } },
      room: { select: { id: true } },
    },
    take: 20,
  });

  for (const task of staleTasks) {
    if (task.room) {
      const recentCheckpoint = await prisma.checkpoint.findFirst({
        where: { roomId: task.room.id, createdAt: { gt: staleCutoff } },
      });
      if (recentCheckpoint) {
        results.push({ taskId: task.id, action: "skipped", reason: "recent_checkpoint" });
        continue;
      }
    }

    await prisma.$transaction(async (tx) => {
      await tx.workerAssignment.updateMany({
        where: { taskId: task.id, status: "active" },
        data: { status: "failed", endedAt: new Date(), reason: "worker_stale_auto_failover" },
      });
      await tx.task.update({
        where: { id: task.id },
        data: {
          status: "pending",
          workerId: null,
          availableForWork: undefined, // 不改 Worker 的 availableForWork，由下面单独处理
        },
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

    // 将失联 Worker 标记为不在线
    if (task.workerId) {
      await prisma.drone.update({
        where: { id: task.workerId },
        data: { availableForWork: false, status: "inactive" },
      });
    }

    results.push({ taskId: task.id, action: "requeued", previousWorker: task.worker?.name });
  }

  // ── 2. 超时待确认任务：Publisher 超期未结算，平台自动结算 ──────────────────
  const overdueSettlements = await prisma.task.findMany({
    where: {
      status: "result_pending",
      settleDeadline: { lt: new Date() },
    },
    include: {
      worker: { select: { id: true, name: true, did: true, nectar: true } },
      publisher: { select: { id: true, name: true, did: true, nectar: true } },
      room: { select: { id: true } },
    },
    take: 20,
  });

  for (const task of overdueSettlements) {
    if (!task.workerId || !task.worker) continue;

    const earned = task.lockedNectar; // 超时自动满额结算，不扣
    const refund = 0;

    try {
      await prisma.$transaction(async (tx) => {
        const fresh = await tx.task.findUnique({ where: { id: task.id } });
        if (!fresh || fresh.status !== "result_pending") return; // 并发保护

        await tx.task.update({
          where: { id: task.id },
          data: {
            status: "completed",
            result: "[AUTO-SETTLED] Publisher did not confirm within deadline. Auto-settled at full amount.",
            actualTokens: task.estimatedTokens,
            rating: 5,
            completedAt: new Date(),
            settleDeadline: null,
          },
        });

        const workerNewBalance = task.worker!.nectar + earned;
        await tx.drone.update({
          where: { id: task.workerId! },
          data: {
            nectar: workerNewBalance,
            totalEarned: { increment: earned },
            tasksCompleted: { increment: 1 },
          },
        });
        await tx.nectarLedger.create({
          data: {
            droneId: task.workerId!, taskId: task.id,
            type: "earn", amount: earned, balanceAfter: workerNewBalance,
            description: `Auto-settled: earned ${earned} Nectar (publisher timeout)`,
          },
        });

        if (task.room) {
          await tx.room.update({
            where: { id: task.room.id },
            data: { status: "closed" },
          });
          await tx.roomMessage.create({
            data: {
              roomId: task.room.id,
              senderId: task.publisherId,
              type: "system",
              content: JSON.stringify({
                event: "auto_settled",
                reason: "publisher_timeout",
                earnedNectar: earned,
              }),
            },
          });
        }

        await tx.workerAssignment.updateMany({
          where: { taskId: task.id, workerId: task.workerId!, status: "active" },
          data: { status: "completed", endedAt: new Date() },
        });
      });

      // 通知 Worker 已自动结算
      if (task.worker.did) {
        await sendAnpMessage(task.worker.did, {
          type: "avep_settled",
          taskId: task.id,
          earnedNectar: earned,
          rating: 5,
          note: "Auto-settled by platform (publisher timeout).",
        }).catch(() => {});
      }

      // 通知 Publisher 已超时自动结算
      if (task.publisher.did) {
        await sendAnpMessage(task.publisher.did, {
          type: "avep_settled",
          taskId: task.id,
          note: "Task auto-settled because you did not confirm within the deadline.",
        }).catch(() => {});
      }

      results.push({ taskId: task.id, action: "auto_settled", earned, refund });
    } catch (e) {
      results.push({ taskId: task.id, action: "auto_settle_failed", error: String(e) });
    }
  }

  return NextResponse.json({
    ok: true,
    processed: results.length,
    results,
    timestamp: new Date().toISOString(),
  });
}
