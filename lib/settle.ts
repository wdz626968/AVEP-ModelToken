/**
 * lib/settle.ts — 任务结算核心逻辑
 *
 * 供三处复用：
 *   1. POST /api/tasks/:id/settle  — Publisher 手动确认结算
 *   2. POST /api/rooms/:id/messages — Worker 提交 result 且任务开启 autoSettle 时
 *   3. GET  /api/cron/stale-tasks   — Publisher 超过 settleDeadline 未操作时自动结算
 */

import { prisma } from "./prisma";
import { transferUsdc, nectarToUsdc } from "./wallet";
import { sendAnpMessage } from "./anp";

export interface SettleResult {
  earned: number;
  refund: number;
}

/**
 * 执行完整结算事务（Nectar 付款 + 退款 + 关闭 Room + 更新 WorkerAssignment）。
 *
 * @param taskId       任务 ID
 * @param actualTokens 实际消耗的 Nectar（由 Worker 在 result 消息中提供，超出 lockedNectar 部分自动截断）
 * @param rating       评分 1-5，默认 5
 * @param resultText   结算备注（完成描述或自动结算说明）
 * @returns { earned, refund }
 * @throws  "CONFLICT:already_settled" 如果任务已被结算（并发保护）
 */
export async function performSettle(
  taskId: string,
  actualTokens: number,
  rating: number = 5,
  resultText: string = ""
): Promise<SettleResult> {
  return prisma.$transaction(async (tx) => {
    const task = await tx.task.findUnique({
      where: { id: taskId },
      include: {
        worker: { select: { id: true, nectar: true, name: true, did: true } },
        publisher: { select: { id: true, nectar: true, name: true, did: true } },
      },
    });

    if (
      !task ||
      (task.status !== "accepted" && task.status !== "result_pending")
    ) {
      throw new Error("CONFLICT:already_settled");
    }

    const earned = Math.min(actualTokens, task.lockedNectar);
    const refund = task.lockedNectar - earned;

    // 更新任务状态
    await tx.task.update({
      where: { id: taskId },
      data: {
        status: "completed",
        result: resultText,
        actualTokens: earned,
        rating,
        completedAt: new Date(),
        settleDeadline: null,
        ackDeadline: null,
        activityDeadline: null,
      },
    });

    // 付款给 Worker
    if (task.workerId && task.worker) {
      const workerNewBalance = task.worker.nectar + earned;
      await tx.drone.update({
        where: { id: task.workerId },
        data: {
          nectar: workerNewBalance,
          totalEarned: { increment: earned },
          tasksCompleted: { increment: 1 },
          availableForWork: true,
        },
      });
      await tx.nectarLedger.create({
        data: {
          droneId: task.workerId,
          taskId,
          type: "earn",
          amount: earned,
          balanceAfter: workerNewBalance,
          description: `Earned ${earned} Nectar for completing task`,
        },
      });
    }

    // 退还 Publisher 多余 Nectar
    if (refund > 0 && task.publisher) {
      const pubNewBalance = task.publisher.nectar + refund;
      await tx.drone.update({
        where: { id: task.publisherId },
        data: { nectar: pubNewBalance },
      });
      await tx.nectarLedger.create({
        data: {
          droneId: task.publisherId,
          taskId,
          type: "refund",
          amount: refund,
          balanceAfter: pubNewBalance,
          description: `Refunded ${refund} Nectar (locked ${task.lockedNectar}, actual ${earned})`,
        },
      });
    }

    // 关闭 Room
    await tx.room.updateMany({
      where: { taskId },
      data: { status: "closed" },
    });

    // 完成 WorkerAssignment
    if (task.workerId) {
      await tx.workerAssignment.updateMany({
        where: { taskId, workerId: task.workerId, status: "active" },
        data: { status: "completed", endedAt: new Date() },
      });
    }

    return { earned, refund };
  });
}

/**
 * 结算完成后的异步后处理：ANP 通知双方 + 链上 USDC 转账。
 * 不阻塞 HTTP 响应，失败只记日志。
 */
export function postSettleAsync(params: {
  taskId: string;
  publisherId: string;
  workerId: string;
  workerDid: string | null | undefined;
  publisherDid: string | null | undefined;
  earned: number;
  rating: number;
  note?: string;
}): void {
  const { taskId, publisherId, workerId, workerDid, publisherDid, earned, rating, note } = params;

  setImmediate(async () => {
    // ANP 通知 Worker 已结算
    if (workerDid) {
      await sendAnpMessage(workerDid, {
        type: "avep_settled",
        taskId,
        earnedNectar: earned,
        rating,
        ...(note ? { note } : {}),
      }).catch(() => {});
    }

    // ANP 通知 Publisher 已结算
    if (publisherDid) {
      await sendAnpMessage(publisherDid, {
        type: "avep_settled",
        taskId,
        ...(note ? { note } : {}),
      }).catch(() => {});
    }

    // 链上 USDC 转账（失败不影响 Nectar 结算）
    try {
      const usdcAmount = nectarToUsdc(earned);
      const tx = await transferUsdc(publisherId, workerId, usdcAmount);
      console.log(JSON.stringify({
        event: "usdc_transfer_submitted",
        taskId,
        from: tx.from,
        to: tx.to,
        usdcAmount,
        transactionHash: tx.transactionHash,
        ts: new Date().toISOString(),
      }));
    } catch (err) {
      console.error(JSON.stringify({
        event: "usdc_transfer_failed",
        taskId,
        earnedNectar: earned,
        error: String(err),
        ts: new Date().toISOString(),
      }));
    }
  });
}
