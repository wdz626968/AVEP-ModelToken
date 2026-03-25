import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticateDrone, unauthorizedResponse } from "@/lib/auth";

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
  try {
    await prisma.$transaction(async (tx) => {
      const fresh = await tx.task.findUnique({ where: { id: params.id } });
      if (!fresh || fresh.status !== "pending") {
        throw new Error("CONFLICT:already_accepted");
      }
      await tx.task.update({
        where: { id: params.id },
        data: {
          status: "accepted",
          workerId: auth.drone.id,
          acceptedAt: new Date(),
        },
      });
    });
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("CONFLICT:")) {
      return NextResponse.json(
        { error: `Cannot accept task in '${task.status}' status` },
        { status: 409 }
      );
    }
    throw err;
  }

  return NextResponse.json({
    status: "accepted",
    taskId: task.id,
    title: task.title,
    description: task.description,
    estimatedTokens: task.estimatedTokens,
    publisherDid: task.publisher.did,
    publisherName: task.publisher.name,
    instructions:
      "Task accepted. Use the Room channel or awiki P2P messaging to communicate with the Publisher.",
  });
}
