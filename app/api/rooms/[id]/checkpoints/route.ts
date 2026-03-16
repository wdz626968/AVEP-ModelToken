import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticateDrone, unauthorizedResponse } from "@/lib/auth";

/**
 * GET /api/rooms/:id/checkpoints — List checkpoints
 * POST /api/rooms/:id/checkpoints — Write a checkpoint
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

  const isParticipant =
    auth.drone.id === room.task.publisherId ||
    auth.drone.id === room.task.workerId;

  if (!isParticipant) {
    return NextResponse.json({ error: "Not a participant" }, { status: 403 });
  }

  const checkpoints = await prisma.checkpoint.findMany({
    where: { roomId: params.id },
    include: { worker: { select: { id: true, name: true } } },
    orderBy: { sequence: "asc" },
  });

  return NextResponse.json({
    roomId: params.id,
    checkpoints: checkpoints.map((cp) => ({
      id: cp.id,
      sequence: cp.sequence,
      progress: cp.progress,
      snapshot: tryParseJson(cp.snapshot),
      worker: cp.worker,
      createdAt: cp.createdAt,
    })),
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

  if (auth.drone.id !== room.task.workerId) {
    return NextResponse.json(
      { error: "Only the current worker can write checkpoints" },
      { status: 403 }
    );
  }

  const body = await request.json();
  const { progress, snapshot } = body;

  if (progress === undefined || progress < 0 || progress > 1) {
    return NextResponse.json(
      { error: "progress is required and must be between 0 and 1" },
      { status: 400 }
    );
  }
  if (!snapshot) {
    return NextResponse.json({ error: "snapshot is required" }, { status: 400 });
  }

  const lastCheckpoint = await prisma.checkpoint.findFirst({
    where: { roomId: params.id },
    orderBy: { sequence: "desc" },
  });

  const nextSequence = (lastCheckpoint?.sequence ?? 0) + 1;

  const checkpoint = await prisma.$transaction(async (tx) => {
    const cp = await tx.checkpoint.create({
      data: {
        roomId: params.id,
        workerId: auth.drone.id,
        sequence: nextSequence,
        progress,
        snapshot: typeof snapshot === "string" ? snapshot : JSON.stringify(snapshot),
      },
    });

    await tx.roomMessage.create({
      data: {
        roomId: params.id,
        senderId: auth.drone.id,
        type: "checkpoint",
        content: JSON.stringify({
          checkpointId: cp.id,
          sequence: nextSequence,
          progress,
        }),
      },
    });

    return cp;
  });

  return NextResponse.json(
    {
      id: checkpoint.id,
      roomId: params.id,
      sequence: checkpoint.sequence,
      progress: checkpoint.progress,
      createdAt: checkpoint.createdAt,
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
