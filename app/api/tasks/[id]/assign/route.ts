import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticateDrone, unauthorizedResponse } from "@/lib/auth";

/**
 * POST /api/tasks/:id/assign
 * Assign a Worker to a task. Creates a Room and WorkerAssignment.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = await authenticateDrone(request);
  if (!auth) return unauthorizedResponse();

  const body = await request.json();
  const { workerId, mode = "centralized" } = body;

  if (!workerId) {
    return NextResponse.json({ error: "workerId is required" }, { status: 400 });
  }

  if (!["centralized", "p2p"].includes(mode)) {
    return NextResponse.json(
      { error: "mode must be 'centralized' or 'p2p'" },
      { status: 400 }
    );
  }

  const task = await prisma.task.findUnique({ where: { id: params.id } });
  if (!task) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }
  if (task.publisherId !== auth.drone.id) {
    return NextResponse.json(
      { error: "Only the publisher can assign workers" },
      { status: 403 }
    );
  }
  if (task.status !== "pending") {
    return NextResponse.json(
      { error: `Cannot assign worker to task in '${task.status}' status` },
      { status: 409 }
    );
  }

  const worker = await prisma.drone.findUnique({ where: { id: workerId } });
  if (!worker) {
    return NextResponse.json({ error: "Worker not found" }, { status: 404 });
  }
  if (worker.id === auth.drone.id) {
    return NextResponse.json({ error: "Cannot assign yourself" }, { status: 403 });
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      // Optimistic lock: re-check status inside transaction to prevent double-assign
      const freshTask = await tx.task.findUnique({ where: { id: params.id } });
      if (!freshTask || freshTask.status !== "pending") {
        throw new Error("CONFLICT:Task already assigned");
      }

      const updatedTask = await tx.task.update({
        where: { id: params.id },
        data: {
          status: "accepted",
          workerId,
          acceptedAt: new Date(),
        },
      });

      const room = await tx.room.create({
        data: {
          taskId: params.id,
          mode,
          status: "active",
        },
      });

      const assignment = await tx.workerAssignment.create({
        data: {
          taskId: params.id,
          workerId,
          status: "active",
        },
      });

      await tx.roomMessage.create({
        data: {
          roomId: room.id,
          senderId: auth.drone.id,
          type: "system",
          content: JSON.stringify({
            event: "worker_assigned",
            workerId,
            workerName: worker.name,
            mode,
          }),
        },
      });

      return { task: updatedTask, room, assignment };
    });

    return NextResponse.json({
      taskId: task.id,
      status: "accepted",
      roomId: result.room.id,
      roomMode: mode,
      assignmentId: result.assignment.id,
      worker: { id: worker.id, name: worker.name, did: worker.did },
    });
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("CONFLICT:")) {
      return NextResponse.json(
        { error: "Task was already assigned by another request" },
        { status: 409 }
      );
    }
    throw err;
  }
}
