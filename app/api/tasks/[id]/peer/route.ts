import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticateDrone, unauthorizedResponse } from "@/lib/auth";

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = await authenticateDrone(request);
  if (!auth) return unauthorizedResponse();

  const task = await prisma.task.findUnique({
    where: { id: params.id },
    include: {
      publisher: { select: { id: true, name: true, did: true } },
      worker: { select: { id: true, name: true, did: true } },
    },
  });

  if (!task) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }

  const isPublisher = auth.drone.id === task.publisherId;
  const isWorker = auth.drone.id === task.workerId;

  if (!isPublisher && !isWorker) {
    return NextResponse.json(
      { error: "You are not a participant of this task" },
      { status: 403 }
    );
  }

  if (task.status === "pending") {
    return NextResponse.json(
      { error: "Task has no worker yet. Peer DID is available after accept." },
      { status: 409 }
    );
  }

  const peer = isPublisher ? task.worker : task.publisher;

  return NextResponse.json({
    taskId: task.id,
    role: isPublisher ? "publisher" : "worker",
    peer: {
      name: peer?.name,
      did: peer?.did,
    },
    awikiHint: peer?.did
      ? `Send a message via awiki: send_message.py --to "${peer.did}" --content '...'`
      : "Peer has no DID registered",
  });
}
