import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticateDrone, unauthorizedResponse } from "@/lib/auth";
import { sendAnpMessage } from "@/lib/anp";
import { performSettle, postSettleAsync } from "@/lib/settle";

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
 *     action: "accept" | "reject",
 *     result: string,
 *     actualTokens: number,   // accept 时必填
 *     rating: number,         // 1-5，默认 5
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

    await prisma.$transaction(async (tx) => {
      await tx.task.update({
        where: { id: params.id },
        data: {
          status: "rejected",
          result: `[REJECTED] ${result}`,
          ackDeadline: null,
          activityDeadline: null,
        },
      });

      // 释放 Worker，使其可以接新任务
      await tx.drone.update({
        where: { id: task.workerId! },
        data: { availableForWork: true },
      });

      // 标记 WorkerAssignment 为失败
      await tx.workerAssignment.updateMany({
        where: { taskId: params.id, workerId: task.workerId!, status: "active" },
        data: { status: "failed", endedAt: new Date(), reason: "publisher_rejected" },
      });
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
      message: "Task rejected. Worker has been released. You may call /switch-worker to reassign.",
    });
  }

  // ── 接受结果，执行结算（复用 lib/settle.ts）──────────────────────────────
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

  let settlement: { earned: number; refund: number };
  try {
    settlement = await performSettle(params.id, actualTokens, rating, result);
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("CONFLICT:")) {
      return NextResponse.json(
        { error: "Task has already been settled" },
        { status: 409 }
      );
    }
    throw err;
  }

  // 异步后处理：ANP 通知双方 + 链上 USDC 转账
  postSettleAsync({
    taskId: task.id,
    publisherId: task.publisherId,
    workerId: task.workerId,
    workerDid: task.worker?.did,
    publisherDid: task.publisher?.did,
    earned: settlement.earned,
    rating,
  });

  return NextResponse.json({
    status: "completed",
    earnedByWorker: settlement.earned,
    refundedToPublisher: settlement.refund,
    rating: rating || null,
    onChain: {
      usdcTransfer: settlement.earned * 0.001,
      note: "链上 USDC 转账已异步提交，可通过 GET /api/drones/me/wallet 查询余额确认",
    },
  });
}
