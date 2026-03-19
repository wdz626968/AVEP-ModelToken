import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticateDrone, unauthorizedResponse } from "@/lib/auth";
import { smartEncrypt, smartDecrypt } from "@/lib/crypto";

/**
 * GET /api/rooms/:id/checkpoints — List checkpoints (decrypts snapshots)
 * POST /api/rooms/:id/checkpoints — Write a checkpoint (encrypts snapshot at rest)
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

  // Allow current + historical workers (for checkpoint handoff)
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
      snapshot: tryParseJson(smartDecrypt(cp.snapshot)),
      worker: cp.worker,
      createdAt: cp.createdAt,
    })),
    encrypted: true,
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
  const { snapshot } = body;
  let { progress } = body;

  if (progress === undefined || progress === null) {
    return NextResponse.json(
      { error: "progress is required (0-1 float or 0-100 integer)" },
      { status: 400 }
    );
  }

  // [R5-fix] Auto-normalize: accept 0-100 integers and convert to 0-1 float
  if (typeof progress === "number" && progress > 1 && progress <= 100) {
    progress = progress / 100;
  }

  if (progress < 0 || progress > 1) {
    return NextResponse.json(
      { error: "progress must be between 0 and 1 (or 0-100, which is auto-normalized)" },
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

  // Encrypt snapshot at rest (AES-256-GCM)
  const rawSnapshot = typeof snapshot === "string" ? snapshot : JSON.stringify(snapshot);
  const encryptedSnapshot = smartEncrypt(rawSnapshot);

  const checkpoint = await prisma.$transaction(async (tx) => {
    const cp = await tx.checkpoint.create({
      data: {
        roomId: params.id,
        workerId: auth.drone.id,
        sequence: nextSequence,
        progress,
        snapshot: encryptedSnapshot,
      },
    });

    // Checkpoint notification message (metadata only, not encrypted)
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
      encrypted: true,
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
