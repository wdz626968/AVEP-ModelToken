import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendAnpMessage } from "@/lib/anp";
import { performSettle, postSettleAsync } from "@/lib/settle";
import { CIRCUIT_COOLDOWN_MS, MAX_RETRY_COUNT } from "@/lib/constants";
import type { TaskStatus } from "@/lib/constants";
import { tryAssignPendingTasksToWorker } from "@/lib/matching";

export const dynamic = "force-dynamic";

/**
 * GET /api/cron/stale-tasks — Vercel Cron（每 1 分钟）
 *
 * 四类自动处理（行业最佳实践：消息租约机制替代心跳）：
 *
 * 1. ACK 超时：任务分配后 30s 内 Worker 未向 Room 发任何消息
 *    → Worker 未响应，视为离线，重新撮合或进入 stalled
 *
 * 2. 活动超时：Worker 已 ACK 但执行中超过 10 分钟无任何 Room 活动
 *    → Worker 执行中失联，重新撮合或进入 stalled
 *
 * 3. Publisher 结算超时：Worker 已提交结果，Publisher 超过 settleDeadline 未确认
 *    → 平台自动以满分结算，保护 Worker 利益
 *
 * 4. Circuit Breaker：同一 Worker 连续在不同任务上触发 ackDeadline 超时 ≥ 3 次
 *    → 自动熔断，标记 availableForWork=false
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
  const now = new Date();

  // ── 1. ACK 超时：Worker 收到任务后 30s 内未向 Room 发消息 ──────────────────
  const ackExpiredTasks = await prisma.task.findMany({
    where: {
      status: "accepted",
      ackDeadline: { lt: now },
      workerId: { not: null },
    },
    include: {
      worker: { select: { id: true, name: true, did: true } },
      publisher: { select: { id: true, did: true } },
      room: { select: { id: true } },
    },
    take: 20,
  });

  for (const task of ackExpiredTasks) {
    const newRetryCount = task.retryCount + 1;
    const shouldStall = newRetryCount >= MAX_RETRY_COUNT;

    await prisma.$transaction(async (tx) => {
      await tx.workerAssignment.updateMany({
        where: { taskId: task.id, workerId: task.workerId!, status: "active" },
        data: { status: "failed", endedAt: new Date(), reason: "ack_timeout" },
      });

      if (shouldStall) {
        await tx.task.update({
          where: { id: task.id },
          data: {
            status: "stalled" as TaskStatus,
            workerId: null,
            ackDeadline: null,
            activityDeadline: null,
            retryCount: newRetryCount,
          },
        });
      } else {
        await tx.task.update({
          where: { id: task.id },
          data: {
            status: "pending",
            workerId: null,
            ackDeadline: null,
            activityDeadline: null,
            retryCount: newRetryCount,
          },
        });
      }

      // 在 Room 写入系统消息记录此事件
      if (task.room) {
        await tx.roomMessage.create({
          data: {
            roomId: task.room.id,
            senderId: task.publisherId,
            type: "system",
            content: JSON.stringify({
              event: "ack_timeout_reassign",
              previousWorkerId: task.workerId,
              retryCount: newRetryCount,
              shouldStall,
            }),
          },
        });
      }
    });

    // Circuit Breaker：标记该 Worker 暂时不可用
    if (task.workerId) {
      await prisma.drone.update({
        where: { id: task.workerId },
        data: { availableForWork: false, status: "inactive" },
      });
    }

    results.push({
      taskId: task.id,
      action: shouldStall ? "stalled" : "requeued_ack_timeout",
      previousWorker: task.worker?.name,
      retryCount: newRetryCount,
    });

    console.log(JSON.stringify({
      event: shouldStall ? "task_stalled" : "task_requeued",
      reason: "ack_timeout",
      taskId: task.id,
      workerId: task.workerId,
      retryCount: newRetryCount,
      ts: now.toISOString(),
    }));
  }

  // ── 2. 活动超时：Worker 已 ACK 但执行中超过 10 分钟无 Room 活动 ─────────────
  const activityExpiredTasks = await prisma.task.findMany({
    where: {
      status: "accepted",
      ackDeadline: null,           // 已 ACK（ackDeadline 已清除）
      activityDeadline: { lt: now }, // 但活动截止已过
      workerId: { not: null },
    },
    include: {
      worker: { select: { id: true, name: true, did: true } },
      room: { select: { id: true } },
    },
    take: 20,
  });

  for (const task of activityExpiredTasks) {
    // 检查是否有最近的 Checkpoint（防止误判）
    if (task.room) {
      const recentCheckpoint = await prisma.checkpoint.findFirst({
        where: {
          roomId: task.room.id,
          createdAt: { gt: new Date(now.getTime() - 10 * 60 * 1000) },
        },
      });
      if (recentCheckpoint) {
        // 有最近 Checkpoint，说明 Worker 在工作，只是没发消息，延长租约
        await prisma.task.update({
          where: { id: task.id },
          data: { activityDeadline: new Date(now.getTime() + 10 * 60 * 1000) },
        });
        results.push({ taskId: task.id, action: "lease_extended_by_checkpoint" });
        continue;
      }
    }

    const newRetryCount = task.retryCount + 1;
    const shouldStall = newRetryCount >= MAX_RETRY_COUNT;

    await prisma.$transaction(async (tx) => {
      await tx.workerAssignment.updateMany({
        where: { taskId: task.id, workerId: task.workerId!, status: "active" },
        data: { status: "failed", endedAt: new Date(), reason: "activity_timeout" },
      });

      await tx.task.update({
        where: { id: task.id },
        data: {
          status: shouldStall ? ("stalled" as TaskStatus) : "pending",
          workerId: null,
          ackDeadline: null,
          activityDeadline: null,
          retryCount: newRetryCount,
        },
      });

      if (task.room) {
        await tx.roomMessage.create({
          data: {
            roomId: task.room.id,
            senderId: task.publisherId,
            type: "system",
            content: JSON.stringify({
              event: "activity_timeout_reassign",
              previousWorkerId: task.workerId,
              retryCount: newRetryCount,
              shouldStall,
            }),
          },
        });
      }
    });

    if (task.workerId) {
      await prisma.drone.update({
        where: { id: task.workerId },
        data: { availableForWork: false, status: "inactive" },
      });
    }

    results.push({
      taskId: task.id,
      action: shouldStall ? "stalled" : "requeued_activity_timeout",
      previousWorker: task.worker?.name,
      retryCount: newRetryCount,
    });
  }

  // ── 3. Publisher 结算超时：自动满额结算，保护 Worker 利益 ──────────────────
  const overdueSettlements = await prisma.task.findMany({
    where: {
      status: "result_pending",
      settleDeadline: { lt: now },
    },
    include: {
      worker: { select: { id: true, name: true, did: true, nectar: true } },
      publisher: { select: { id: true, name: true, did: true, nectar: true } },
    },
    take: 20,
  });

  for (const task of overdueSettlements) {
    if (!task.workerId || !task.worker) continue;

    const autoResultText = "[AUTO-SETTLED] Publisher did not confirm within deadline. Auto-settled at full amount.";

    try {
      const settlement = await performSettle(
        task.id,
        task.estimatedTokens,
        5,
        autoResultText
      );

      postSettleAsync({
        taskId: task.id,
        publisherId: task.publisherId,
        workerId: task.workerId,
        workerDid: task.worker.did,
        publisherDid: task.publisher.did,
        earned: settlement.earned,
        rating: 5,
        note: "Auto-settled by platform (publisher timeout).",
      });

      results.push({
        taskId: task.id,
        action: "auto_settled",
        earned: settlement.earned,
        refund: settlement.refund,
      });
    } catch (e) {
      if (e instanceof Error && e.message.startsWith("CONFLICT:")) continue;
      results.push({ taskId: task.id, action: "auto_settle_failed", error: String(e) });
    }
  }

  // ── 4. Circuit Breaker 冷却恢复：标记不可用超过 30 分钟且无活跃任务的 Worker ──
  // 30 分钟冷却后自动恢复为 available（半开状态，下次分配时验证）
  const cooldownCutoff = new Date(now.getTime() - CIRCUIT_COOLDOWN_MS);

  const recoveredWorkers = await prisma.drone.findMany({
    where: {
      status: "inactive",
      availableForWork: false,
      updatedAt: { lt: cooldownCutoff },
    },
    select: { id: true, name: true },
  });

  if (recoveredWorkers.length > 0) {
    await prisma.drone.updateMany({
      where: { id: { in: recoveredWorkers.map((w) => w.id) } },
      data: { availableForWork: true },
    });

    results.push({ action: "circuit_breaker_reset", count: recoveredWorkers.length });

    // 恢复后立即触发补撮合，让这些 Worker 承接积压的 pending 任务
    for (const worker of recoveredWorkers) {
      tryAssignPendingTasksToWorker(
        worker.id,
        async (toDid, payload) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await sendAnpMessage(toDid, payload as any);
        }
      ).catch((e) => console.error(`[cron] rematch for recovered worker ${worker.name} failed:`, e));
    }
  }

  // ── 5. stalled 任务自动恢复：超过 24h 仍 stalled 则重置为 pending ────────────
  // cron 每天运行一次，正好覆盖这个场景：昨天进入 stalled 的任务今天自动重开
  const stalledCutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const stalledRevived = await prisma.task.updateMany({
    where: {
      status: "stalled",
      updatedAt: { lt: stalledCutoff },
    },
    data: {
      status: "pending",
      workerId: null,
      retryCount: 0,
      ackDeadline: null,
      activityDeadline: null,
    },
  });

  if (stalledRevived.count > 0) {
    results.push({ action: "stalled_revived", count: stalledRevived.count });
    console.log(JSON.stringify({
      event: "stalled_tasks_revived",
      count: stalledRevived.count,
      ts: now.toISOString(),
    }));
  }

  // ── 6. 兜底：accepted 状态但 ackDeadline 和 activityDeadline 均为 null ────────
  // 正常情况下不应出现，但 accept 端点历史 bug 可能遗留此状态
  // 超过 30 分钟无任何进展，强制重置为 pending
  const ghostCutoff = new Date(now.getTime() - 30 * 60 * 1000);
  const ghostTasks = await prisma.task.findMany({
    where: {
      status: "accepted",
      ackDeadline: null,
      activityDeadline: null,
      workerId: { not: null },
      acceptedAt: { lt: ghostCutoff },
    },
    select: { id: true, workerId: true, retryCount: true, room: { select: { id: true } } },
    take: 20,
  });

  for (const task of ghostTasks) {
    const newRetryCount = task.retryCount + 1;
    const shouldStall = newRetryCount >= MAX_RETRY_COUNT;

    await prisma.$transaction(async (tx) => {
      await tx.workerAssignment.updateMany({
        where: { taskId: task.id, workerId: task.workerId!, status: "active" },
        data: { status: "failed", endedAt: now, reason: "ghost_accepted" },
      });
      await tx.task.update({
        where: { id: task.id },
        data: {
          status: shouldStall ? ("stalled" as TaskStatus) : "pending",
          workerId: null,
          ackDeadline: null,
          activityDeadline: null,
          retryCount: newRetryCount,
        },
      });
      if (task.room) {
        await tx.roomMessage.create({
          data: {
            roomId: task.room.id,
            senderId: task.workerId!,
            type: "system",
            content: JSON.stringify({
              event: "ghost_accepted_reset",
              previousWorkerId: task.workerId,
              retryCount: newRetryCount,
              shouldStall,
            }),
          },
        });
      }
    });

    results.push({
      taskId: task.id,
      action: shouldStall ? "ghost_stalled" : "ghost_requeued",
      retryCount: newRetryCount,
    });
  }

  return NextResponse.json({
    ok: true,
    processed: results.length,
    results,
    timestamp: now.toISOString(),
  });
}
