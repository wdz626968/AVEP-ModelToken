import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticateDrone, unauthorizedResponse } from "@/lib/auth";
import { sendAnpMessage } from "@/lib/anp";

/**
 * POST /api/tasks/:id/settle
 *
 * Publisher 确认结算。Worker 完成任务后，AVEP 通过 ANP 推送结果给 Publisher，
 * Publisher 调此接口确认（接受/拒绝）并触发 Nectar 结算。
 *
 * 超时自动结算：
 *   - Worker 完成后，任务进入 "result_pending" 状态，settleDeadline = now + 48h
 *   - Publisher 未在截止前操作 → cron job 自动以满分结算（保护 Worker 利益）
 *   - Publisher 可拒绝（附原因），拒绝后可选 switch-worker 重新分配
 *
 * Body:
 *   {
 *     action: "accept" | "reject",   // 接受或拒绝结果
 *     result: string,                 // 结算备注（accept 时为确认描述，reject 时为拒绝原因）
 *     actualTokens: number,           // accept 时必填：实际消耗 token 数
 *     rating: number,                 // 1-5，默认 5
 *   }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = await authenticateDrone(request);
  if (!auth) return unauthorizedResponse();

  const task = await prisma.task.findUnique({
    where: { id: params.id },
    include: {
      worker: { select: { id: true, name: true, did: true } },
      publisher: { select: { id: true, name: true, did: true } },
    },
  });

  if (!task) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }
  if (task.publisherId !== auth.drone.id) {
    return NextResponse.json(
      { error: "Only the publisher can settle this task" },
      { status: 403 }
    );
  }
  if (!task.workerId) {
    return NextResponse.json(
      { error: "No worker assigned to this task" },
      { status: 409 }
    );
  }

  // 允许在 "accepted"（兼容旧流程）或 "result_pending"（新流程）状态下结算
  if (task.status !== "accepted" && task.status !== "result_pending") {
    return NextResponse.json(
      { error: `Cannot settle task in status "${task.status}"` },
      { status: 409 }
    );
  }

  const body = await request.json();
  const { action = "accept", result, actualTokens, rating = 5 } = body;

  if (!["accept", "reject"].includes(action)) {
    return NextResponse.json(
      { error: 'action must be "accept" or "reject"' },
      { status: 400 }
    );
  }

  // ── 拒绝结果 ──────────────────────────────────────────────────────────────
  if (action === "reject") {
    if (!result) {
      return NextResponse.json(
        { error: "result (rejection reason) is required when action=reject" },
        { status: 400 }
      );
    }

    await prisma.task.update({
      where: { id: params.id },
      data: { status: "rejected", result: `[REJECTED] ${result}` },
    });

    // 通知 Worker 被拒绝
    if (task.worker?.did) {
      setImmediate(() => {
        sendAnpMessage(task.worker!.did!, {
          type: "avep_switch_worker",
          taskId: task.id,
          reason: result,
        }).catch(() => {});
      });
    }

    return NextResponse.json({
      status: "rejected",
      message: "Task rejected. You may call /switch-worker to reassign.",
    });
  }

  // ── 接受结果，执行结算 ────────────────────────────────────────────────────
  if (!result) {
    return NextResponse.json(
      { error: "result is required when action=accept" },
      { status: 400 }
    );
  }
  if (!actualTokens || actualTokens <= 0) {
    return NextResponse.json(
      { error: "actualTokens (number > 0) is required when action=accept" },
      { status: 400 }
    );
  }

  const capped = Math.min(actualTokens, task.lockedNectar);
  const earned = capped;
  const refund = task.lockedNectar - earned;

  let settlement: { earned: number; refund: number };
  try {
    settlement = await prisma.$transaction(async (tx) => {
      const fresh = await tx.task.findUnique({ where: { id: params.id } });
      if (!fresh || (fresh.status !== "accepted" && fresh.status !== "result_pending")) {
        throw new Error("CONFLICT:already_settled");
      }

      await tx.task.update({
        where: { id: params.id },
        data: {
          status: "completed",
          result,
          actualTokens: capped,
          rating: rating || null,
          completedAt: new Date(),
          settleDeadline: null,
        },
      });

      // 付款给 Worker
      const worker = await tx.drone.findUniqueOrThrow({ where: { id: task.workerId! } });
      const workerNewBalance = worker.nectar + earned;
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
          droneId: task.workerId!, taskId: params.id,
          type: "earn", amount: earned, balanceAfter: workerNewBalance,
          description: `Earned ${earned} Nectar for completing task`,
        },
      });

      // 退还 Publisher 多余 Nectar
      if (refund > 0) {
        const publisher = await tx.drone.findUniqueOrThrow({ where: { id: task.publisherId } });
        const pubNewBalance = publisher.nectar + refund;
        await tx.drone.update({
          where: { id: task.publisherId },
          data: { nectar: pubNewBalance },
        });
        await tx.nectarLedger.create({
          data: {
            droneId: task.publisherId, taskId: params.id,
            type: "refund", amount: refund, balanceAfter: pubNewBalance,
            description: `Refunded ${refund} Nectar (locked ${task.lockedNectar}, actual ${earned})`,
          },
        });
      }

      // 关闭 Room
      await tx.room.updateMany({
        where: { taskId: params.id },
        data: { status: "closed" },
      });

      await tx.workerAssignment.updateMany({
        where: { taskId: params.id, workerId: task.workerId!, status: "active" },
        data: { status: "completed", endedAt: new Date() },
      });

      return { earned, refund };
    });
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("CONFLICT:")) {
      return NextResponse.json(
        { error: "Task has already been settled" },
        { status: 409 }
      );
    }
    throw err;
  }

  // 通知 Worker 已结算（可选，不阻塞响应）
  if (task.worker?.did) {
    setImmediate(() => {
      sendAnpMessage(task.worker!.did!, {
        type: "avep_settled",
        taskId: task.id,
        earnedNectar: settlement.earned,
        rating: rating || 5,
      }).catch(() => {});
    });
  }

  return NextResponse.json({
    status: "completed",
    earnedByWorker: settlement.earned,
    refundedToPublisher: settlement.refund,
    rating: rating || null,
  });
}
