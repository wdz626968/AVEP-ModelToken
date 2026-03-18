import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticateDrone, unauthorizedResponse } from "@/lib/auth";
import { refundNectar, cancelWithCompensation } from "@/lib/nectar";

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = await authenticateDrone(request);
  if (!auth) return unauthorizedResponse();

  const task = await prisma.task.findUnique({
    where: { id: params.id },
    include: { room: true },
  });
  if (!task) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }

  if (task.publisherId !== auth.drone.id) {
    return NextResponse.json(
      { error: "Only the publisher can cancel this task" },
      { status: 403 }
    );
  }

  if (!["pending", "accepted"].includes(task.status)) {
    return NextResponse.json(
      { error: `Cannot cancel task in '${task.status}' status (only pending or accepted tasks can be cancelled)` },
      { status: 409 }
    );
  }

  // Pending task: full refund, no worker involved
  if (task.status === "pending") {
    const newBalance = await refundNectar(
      auth.drone.id,
      task.id,
      task.lockedNectar
    );

    await prisma.task.update({
      where: { id: params.id },
      data: { status: "cancelled" },
    });

    return NextResponse.json({
      status: "cancelled",
      compensationType: "full_refund",
      refundedNectar: task.lockedNectar,
      workerCompensation: 0,
      newBalance,
    });
  }

  // Accepted task: compensate worker based on progress
  if (!task.workerId) {
    return NextResponse.json(
      { error: "Accepted task has no assigned worker" },
      { status: 500 }
    );
  }

  // Find latest checkpoint to determine progress
  let progress = 0;
  if (task.room) {
    const latestCheckpoint = await prisma.checkpoint.findFirst({
      where: { roomId: task.room.id },
      orderBy: { sequence: "desc" },
    });
    if (latestCheckpoint) {
      progress = latestCheckpoint.progress;
    }
  }

  const { compensation, refund } = await cancelWithCompensation(
    task.id,
    auth.drone.id,
    task.workerId,
    task.lockedNectar,
    progress
  );

  // Update task and worker assignment
  await prisma.$transaction(async (tx) => {
    await tx.task.update({
      where: { id: params.id },
      data: { status: "cancelled" },
    });

    await tx.workerAssignment.updateMany({
      where: { taskId: params.id, workerId: task.workerId!, status: "active" },
      data: { status: "failed", endedAt: new Date(), reason: "publisher_cancelled" },
    });

    // Post cancellation notification to room
    if (task.room) {
      await tx.roomMessage.create({
        data: {
          roomId: task.room.id,
          senderId: auth.drone.id,
          type: "system",
          content: JSON.stringify({
            event: "task_cancelled",
            cancelledBy: auth.drone.id,
            progress,
            workerCompensation: compensation,
            publisherRefund: refund,
          }),
        },
      });
    }
  });

  // Get updated balances
  const [publisher, worker] = await Promise.all([
    prisma.drone.findUnique({ where: { id: auth.drone.id }, select: { nectar: true } }),
    prisma.drone.findUnique({ where: { id: task.workerId }, select: { nectar: true } }),
  ]);

  return NextResponse.json({
    status: "cancelled",
    compensationType: "progress_based",
    progress,
    workerCompensation: compensation,
    publisherRefund: refund,
    publisherBalance: publisher?.nectar,
    workerBalance: worker?.nectar,
  });
}
