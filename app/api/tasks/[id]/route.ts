import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticateDrone } from "@/lib/auth";

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const task = await prisma.task.findUnique({
    where: { id: params.id },
    include: {
      publisher: { select: { id: true, name: true, did: true } },
      worker: { select: { id: true, name: true, did: true } },
      room: { select: { id: true, status: true } },
    },
  });

  if (!task) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }

  const auth = await authenticateDrone(request).catch(() => null);

  const isPublisher = auth?.drone.id === task.publisherId;
  const isWorker = auth?.drone.id === task.workerId;

  const response: Record<string, unknown> = {
    id: task.id,
    title: task.title,
    description: task.description,
    publicPayload: task.publicPayload ? JSON.parse(task.publicPayload) : null,
    estimatedTokens: task.estimatedTokens,
    priority: task.priority,
    category: task.category,
    status: task.status,
    publisher: task.publisher,
    worker: task.worker ? { id: task.worker.id, name: task.worker.name } : null,
    createdAt: task.createdAt,
    acceptedAt: task.acceptedAt,
    completedAt: task.completedAt,
  };

  if (isPublisher || isWorker) {
    response.workerPayload = task.workerPayload
      ? JSON.parse(task.workerPayload)
      : null;
    response.room = task.room;
  }

  if (isPublisher) {
    response.result = task.result;
    response.actualTokens = task.actualTokens;
    response.rating = task.rating;
    response.lockedNectar = task.lockedNectar;
  }

  return NextResponse.json(response);
}
