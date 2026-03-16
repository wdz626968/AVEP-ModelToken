import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticateDrone, unauthorizedResponse } from "@/lib/auth";

/**
 * POST /api/tasks/:id/switch-worker
 * Switch the active Worker. Old Worker is marked as "switched",
 * new Worker enters the same Room and inherits context.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = await authenticateDrone(request);
  if (!auth) return unauthorizedResponse();

  const body = await request.json();
  const { newWorkerId, reason } = body;

  if (!newWorkerId) {
    return NextResponse.json({ error: "newWorkerId is required" }, { status: 400 });
  }

  const task = await prisma.task.findUnique({
    where: { id: params.id },
    include: { room: true },
  });
  if (!task) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }
  if (task.publisherId !== auth.drone.id) {
    return NextResponse.json(
      { error: "Only the publisher can switch workers" },
      { status: 403 }
    );
  }
  if (task.status !== "accepted") {
    return NextResponse.json(
      { error: "Can only switch worker on accepted tasks" },
      { status: 409 }
    );
  }

  const newWorker = await prisma.drone.findUnique({ where: { id: newWorkerId } });
  if (!newWorker) {
    return NextResponse.json({ error: "New worker not found" }, { status: 404 });
  }

  const result = await prisma.$transaction(async (tx) => {
    if (task.workerId) {
      await tx.workerAssignment.updateMany({
        where: { taskId: params.id, workerId: task.workerId, status: "active" },
        data: { status: "switched", endedAt: new Date(), reason: reason || "publisher_switched" },
      });
    }

    await tx.task.update({
      where: { id: params.id },
      data: { workerId: newWorkerId },
    });

    const assignment = await tx.workerAssignment.create({
      data: {
        taskId: params.id,
        workerId: newWorkerId,
        status: "active",
      },
    });

    if (task.room) {
      await tx.roomMessage.create({
        data: {
          roomId: task.room.id,
          senderId: auth.drone.id,
          type: "system",
          content: JSON.stringify({
            event: "worker_switched",
            previousWorkerId: task.workerId,
            newWorkerId,
            newWorkerName: newWorker.name,
            reason: reason || "publisher_switched",
          }),
        },
      });
    }

    const latestCheckpoint = await tx.checkpoint.findFirst({
      where: { roomId: task.room?.id },
      orderBy: { sequence: "desc" },
    });

    return { assignment, latestCheckpoint };
  });

  return NextResponse.json({
    taskId: task.id,
    previousWorkerId: task.workerId,
    newWorker: { id: newWorker.id, name: newWorker.name, did: newWorker.did },
    assignmentId: result.assignment.id,
    roomId: task.room?.id,
    latestCheckpoint: result.latestCheckpoint
      ? { sequence: result.latestCheckpoint.sequence, progress: result.latestCheckpoint.progress }
      : null,
  });
}
