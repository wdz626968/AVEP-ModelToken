import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticateDrone, unauthorizedResponse } from "@/lib/auth";
import { smartEncrypt, smartDecrypt } from "@/lib/crypto";

/**
 * GET /api/rooms/:id/messages — List messages in a Room (decrypts at rest)
 * POST /api/rooms/:id/messages — Send a message to a Room (encrypts at rest)
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

  // Also check historical workers (for worker switch continuity)
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

  const { searchParams } = new URL(request.url);
  const limit = Math.min(parseInt(searchParams.get("limit") || "50"), 200);
  const cursor = searchParams.get("cursor");

  const messages = await prisma.roomMessage.findMany({
    where: { roomId: params.id },
    include: { sender: { select: { id: true, name: true, did: true } } },
    orderBy: { createdAt: "asc" },
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });

  const hasNext = messages.length > limit;
  const items = hasNext ? messages.slice(0, limit) : messages;

  return NextResponse.json({
    roomId: params.id,
    messages: items.map((m) => ({
      id: m.id,
      type: m.type,
      content: tryParseJson(smartDecrypt(m.content)),
      sender: m.sender,
      createdAt: m.createdAt,
    })),
    nextCursor: hasNext ? items[items.length - 1].id : null,
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

  const isParticipant =
    auth.drone.id === room.task.publisherId ||
    auth.drone.id === room.task.workerId;

  if (!isParticipant) {
    return NextResponse.json({ error: "Not a participant" }, { status: 403 });
  }

  const body = await request.json();
  const { type, content } = body;

  if (!type || content === undefined) {
    return NextResponse.json(
      { error: "type and content are required" },
      { status: 400 }
    );
  }

  const validTypes = [
    "task_payload", "ready", "progress", "clarify",
    "supplement", "result", "checkpoint", "system",
  ];
  if (!validTypes.includes(type)) {
    return NextResponse.json(
      { error: `Invalid message type. Valid: ${validTypes.join(", ")}` },
      { status: 400 }
    );
  }

  // Encrypt content at rest (AES-256-GCM, <0.1ms overhead)
  const rawContent = typeof content === "string" ? content : JSON.stringify(content);
  const encryptedContent = smartEncrypt(rawContent);

  const message = await prisma.roomMessage.create({
    data: {
      roomId: params.id,
      senderId: auth.drone.id,
      type,
      content: encryptedContent,
    },
    include: { sender: { select: { id: true, name: true, did: true } } },
  });

  return NextResponse.json(
    {
      id: message.id,
      roomId: params.id,
      type: message.type,
      content: tryParseJson(rawContent),
      sender: message.sender,
      createdAt: message.createdAt,
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
