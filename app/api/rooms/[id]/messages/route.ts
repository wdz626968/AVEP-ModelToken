import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticateDrone, unauthorizedResponse } from "@/lib/auth";
import { smartEncrypt, smartDecrypt } from "@/lib/crypto";
import { sendAnpMessage } from "@/lib/anp";
import type { TaskStatus } from "@/lib/constants";

/**
 * GET /api/rooms/:id/messages — List messages in a Room (decrypts at rest)
 * POST /api/rooms/:id/messages — Send a message to a Room (encrypts at rest)
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = await authenticateDrone(request);
  if (!auth) return unauthorizedResponse();

  const room = await prisma.room.findUnique({
    where: { id: params.id },
    include: { task: { select: { publisherId: true, workerId: true } } },
  });

  if (!room) {
    return NextResponse.json({ error: "Room not found" }, { status: 404 });
  }

  // Also check historical workers (for worker switch continuity)
  const isCurrentParticipant =
    auth.drone.id === room.task.publisherId ||
    auth.drone.id === room.task.workerId;

  let isHistoricalWorker = false;
  if (!isCurrentParticipant) {
    const assignment = await prisma.workerAssignment.findFirst({
      where: { taskId: room.taskId, workerId: auth.drone.id },
    });
    isHistoricalWorker = !!assignment;
  }

  if (!isCurrentParticipant && !isHistoricalWorker) {
    return NextResponse.json({ error: "Not a participant" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const limit = Math.min(parseInt(searchParams.get("limit") || "50"), 200);
  const cursor = searchParams.get("cursor");

  const messages = await prisma.roomMessage.findMany({
    where: { roomId: params.id },
    include: { sender: { select: { id: true, name: true, did: true } } },
    orderBy: { createdAt: "asc" },
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });

  const hasNext = messages.length > limit;
  const items = hasNext ? messages.slice(0, limit) : messages;

  return NextResponse.json({
    roomId: params.id,
    messages: items.map((m) => ({
      id: m.id,
      type: m.type,
      content: tryParseJson(smartDecrypt(m.content)),
      sender: m.sender,
      createdAt: m.createdAt,
    })),
    nextCursor: hasNext ? items[items.length - 1].id : null,
  });
}

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = await authenticateDrone(request);
  if (!auth) return unauthorizedResponse();

  const room = await prisma.room.findUnique({
    where: { id: params.id },
    include: { task: { select: { publisherId: true, workerId: true, status: true } } },
  });

  if (!room) {
    return NextResponse.json({ error: "Room not found" }, { status: 404 });
  }

  if (room.status !== "active") {
    return NextResponse.json({ error: "Room is closed" }, { status: 409 });
  }

  const isParticipant =
    auth.drone.id === room.task.publisherId ||
    auth.drone.id === room.task.workerId;

  if (!isParticipant) {
    return NextResponse.json({ error: "Not a participant" }, { status: 403 });
  }

  const body = await request.json();
  const { type, content } = body;

  if (!type || content === undefined) {
    return NextResponse.json(
      { error: "type and content are required" },
      { status: 400 }
    );
  }

  const validTypes = [
    "task_payload", "ready", "progress", "clarify",
    "supplement", "result", "checkpoint", "worker_abort", "system",
  ];
  if (!validTypes.includes(type)) {
    return NextResponse.json(
      { error: `Invalid message type. Valid: ${validTypes.join(", ")}` },
      { status: 400 }
    );
  }

  // Encrypt content at rest (AES-256-GCM, <0.1ms overhead)
  const rawContent = typeof content === "string" ? content : JSON.stringify(content);
  const encryptedContent = smartEncrypt(rawContent);

  const message = await prisma.roomMessage.create({
    data: {
      roomId: params.id,
      senderId: auth.drone.id,
      type,
      content: encryptedContent,
    },
    include: { sender: { select: { id: true, name: true, did: true } } },
  });

  // ── Worker 发任何非 system/worker_abort 消息时，更新租约状态 ──────────────
  // worker_abort 不刷新租约（Bug3修复：避免先 availableForWork=true 再 false 的逻辑倒置）
  const isWorkerMessage = auth.drone.id === room.task.workerId
    && type !== "system"
    && type !== "worker_abort";
  if (isWorkerMessage) {
    const ACTIVITY_DEADLINE_MS = 10 * 60 * 1000;
    await prisma.task.update({
      where: { id: room.taskId },
      data: {
        ackDeadline: null,
        activityDeadline: new Date(Date.now() + ACTIVITY_DEADLINE_MS),
      },
    });
    await prisma.drone.update({
      where: { id: auth.drone.id },
      data: { availableForWork: true, status: "active" },
    });
  }

  // ── 当 Worker 发送 result 消息时，触发后续流程 ─────────────────────────
  if (type === "result") {
    setImmediate(async () => {
      try {
        const SETTLE_DEADLINE_HOURS = 48;
        const settleDeadline = new Date(Date.now() + SETTLE_DEADLINE_HOURS * 60 * 60 * 1000);

        // 解析 result 内容，提取 actualTokens（供 Publisher 参考）
        let parsedContent: Record<string, unknown> = {};
        try {
          parsedContent = typeof content === "string" ? JSON.parse(content) : content;
        } catch { /* 内容非 JSON，忽略 */ }
        const actualTokens = typeof parsedContent.actualTokens === "number"
          ? parsedContent.actualTokens
          : null;
        const resultText = typeof parsedContent.result === "string"
          ? parsedContent.result
          : rawContent;

        // 1. 将任务标记为 result_pending，设置结算截止时间，清除活动截止
        const task = await prisma.task.update({
          where: { id: room.taskId },
          data: {
            status: "result_pending",
            settleDeadline,
            activityDeadline: null, // 任务已完成，不再需要续租
          },
          include: {
            publisher: { select: { id: true, did: true, name: true } },
          },
        });

        // 2. 将 Worker 标记为空闲（可以接新任务）
        await prisma.drone.update({
          where: { id: auth.drone.id },
          data: { availableForWork: true },
        });

        // 3. ANP 推送给 Publisher：结果已就绪，直接带上结果内容（Publisher 无需读 Room）
        if (task.publisher.did) {
          await sendAnpMessage(task.publisher.did, {
            type: "avep_result_ready",
            taskId: task.id,
            roomId: params.id,
            settleDeadline: settleDeadline.toISOString(),
            workerName: auth.drone.name,
            // 直接内嵌结果内容，Publisher 无需主动拉取 Room 消息
            result: resultText,
            ...(actualTokens !== null ? { actualTokens } : {}),
            note: `Task completed. Auto-settle in ${SETTLE_DEADLINE_HOURS}h if no action. To confirm: POST /api/tasks/${task.id}/settle`,
          });
        }
      } catch (e) {
        console.error("[result] post-processing failed:", e);
      }
    });
  }

  // ── 当 Worker 主动发送 worker_abort 消息时，立即触发重新撮合 ─────────────
  if (type === "worker_abort") {
    setImmediate(async () => {
      try {
        let reason = "worker_abort";
        try {
          const parsed = typeof content === "string" ? JSON.parse(content) : content;
          reason = parsed.reason || reason;
        } catch { /* 忽略 */ }

        // Bug2修复：整个 read-modify-write 包入事务，防止与 cron 并发导致竞态
        await prisma.$transaction(async (tx) => {
          const task = await tx.task.findUnique({
            where: { id: room.taskId },
          });
          if (!task || (task.status !== "accepted" && task.status !== "result_pending")) return;

          // 标记 WorkerAssignment 为 failed
          await tx.workerAssignment.updateMany({
            where: { taskId: room.taskId, workerId: auth.drone.id, status: "active" },
            data: { status: "failed", endedAt: new Date(), reason },
          });

          // 标记 Worker 不可用（熔断）
          await tx.drone.update({
            where: { id: auth.drone.id },
            data: { availableForWork: false },
          });

          const newRetryCount = task.retryCount + 1;
          if (newRetryCount >= 3) {
            await tx.task.update({
              where: { id: room.taskId },
              data: {
                status: "stalled" as TaskStatus,
                retryCount: newRetryCount,
                ackDeadline: null,
                activityDeadline: null,
              },
            });
            console.log(JSON.stringify({ event: "task_stalled", taskId: room.taskId, reason: "max_retries_exceeded", ts: new Date().toISOString() }));
          } else {
            await tx.task.update({
              where: { id: room.taskId },
              data: {
                status: "pending",
                workerId: null,
                retryCount: newRetryCount,
                ackDeadline: null,
                activityDeadline: null,
              },
            });
          }
        });

        console.log(JSON.stringify({ event: "worker_abort", taskId: room.taskId, workerId: auth.drone.id, reason, ts: new Date().toISOString() }));
      } catch (e) {
        console.error("[worker_abort] post-processing failed:", e);
      }
    });
  }

  return NextResponse.json(
    {
      id: message.id,
      roomId: params.id,
      type: message.type,
      content: tryParseJson(rawContent),
      sender: message.sender,
      createdAt: message.createdAt,
    },
    { status: 201 }
  );
}

function tryParseJson(str: string): unknown {
  try {
    return JSON.parse(str);
  } catch {
    return str;
  }
}
