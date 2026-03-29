import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticateDrone, unauthorizedResponse } from "@/lib/auth";
import { sendAnpMessage } from "@/lib/anp";
import { ACK_DEADLINE_MS } from "@/lib/constants";

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = await authenticateDrone(request);
  if (!auth) return unauthorizedResponse();

  // Pre-flight read (no side effects)
  const task = await prisma.task.findUnique({
    where: { id: params.id },
    include: { publisher: { select: { id: true, name: true, did: true } } },
  });
  if (!task) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }
  if (task.publisherId === auth.drone.id) {
    return NextResponse.json(
      { error: "Cannot accept your own task" },
      { status: 403 }
    );
  }

  // Optimistic lock: re-confirm status inside transaction to prevent double-accept
  // Also create Room + WorkerAssignment + set ackDeadline atomically
  let roomId: string;
  try {
    const result = await prisma.$transaction(async (tx) => {
      const fresh = await tx.task.findUnique({ where: { id: params.id } });
      if (!fresh || fresh.status !== "pending") {
        throw new Error("CONFLICT:already_accepted");
      }

      const now = new Date();
      await tx.task.update({
        where: { id: params.id },
        data: {
          status: "accepted",
          workerId: auth.drone.id,
          acceptedAt: now,
          ackDeadline: new Date(now.getTime() + ACK_DEADLINE_MS),
        },
      });

      const room = await tx.room.create({
        data: { taskId: params.id, mode: "centralized", status: "active" },
      });

      await tx.workerAssignment.create({
        data: { taskId: params.id, workerId: auth.drone.id, status: "active" },
      });

      await tx.roomMessage.create({
        data: {
          roomId: room.id,
          senderId: task.publisherId,
          type: "system",
          content: JSON.stringify({
            event: "worker_assigned",
            workerId: auth.drone.id,
            workerName: auth.drone.name,
            mode: "centralized",
            autoAssigned: false,
          }),
        },
      });

      return { room };
    });
    roomId = result.room.id;
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("CONFLICT:")) {
      return NextResponse.json(
        { error: `Cannot accept task in '${task.status}' status` },
        { status: 409 }
      );
    }
    throw err;
  }

  // 通知 Publisher：有 Worker 接单了
  if (task.publisher.did) {
    setImmediate(() => {
      sendAnpMessage(task.publisher.did!, {
        type: "avep_worker_assigned",
        taskId: task.id,
        roomId,
        workerDid: auth.drone.did ?? undefined,
        workerName: auth.drone.name,
      }).catch((e) => console.error("[accept] notify publisher failed:", e));
    });
  }

  return NextResponse.json({
    status: "accepted",
    taskId: task.id,
    roomId,
    title: task.title,
    description: task.description,
    estimatedTokens: task.estimatedTokens,
    publisherDid: task.publisher.did,
    publisherName: task.publisher.name,
    instructions: [
      `1. Immediately POST to /api/rooms/${roomId}/messages with { "type": "ready", "content": "acknowledged" } within 30s`,
      "2. Execute the task",
      `3. POST result to /api/rooms/${roomId}/messages with { "type": "result", "content": { "result": "...", "actualTokens": N } }`,
    ],
  });
}
