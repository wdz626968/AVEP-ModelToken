import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticateDrone, unauthorizedResponse } from "@/lib/auth";

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = await authenticateDrone(request);
  if (!auth) return unauthorizedResponse();

  const task = await prisma.task.findUnique({
    where: { id: params.id },
    include: { publisher: { select: { id: true, name: true, did: true } } },
  });
  if (!task) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }

  if (task.status !== "pending") {
    return NextResponse.json(
      { error: `Cannot accept task in '${task.status}' status` },
      { status: 409 }
    );
  }

  if (task.publisherId === auth.drone.id) {
    return NextResponse.json(
      { error: "Cannot accept your own task" },
      { status: 403 }
    );
  }

  await prisma.task.update({
    where: { id: params.id },
    data: {
      status: "accepted",
      workerId: auth.drone.id,
      acceptedAt: new Date(),
    },
  });

  return NextResponse.json({
    status: "accepted",
    taskId: task.id,
    title: task.title,
    description: task.description,
    estimatedTokens: task.estimatedTokens,
    publisherDid: task.publisher.did,
    publisherName: task.publisher.name,
    p2pInstructions:
      "Use awiki messaging to contact the Publisher for task details. " +
      "Send a hivegrid:ready message to their DID, they will reply with the workerPayload.",
  });
}
