import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticateAdmin, adminUnauthorized } from "@/lib/admin-auth";

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const authed = await authenticateAdmin(request);
  if (!authed) return adminUnauthorized();

  const room = await prisma.room.findUnique({
    where: { id: params.id },
    include: {
      task: {
        select: {
          id: true,
          title: true,
          status: true,
          estimatedTokens: true,
          publisher: { select: { name: true } },
          worker: { select: { name: true } },
        },
      },
      messages: {
        include: { sender: { select: { name: true, did: true } } },
        orderBy: { createdAt: "asc" },
      },
      checkpoints: {
        include: { worker: { select: { name: true } } },
        orderBy: { sequence: "asc" },
      },
    },
  });

  if (!room) {
    return NextResponse.json({ error: "Room not found" }, { status: 404 });
  }

  return NextResponse.json({
    id: room.id,
    mode: room.mode,
    status: room.status,
    task: room.task,
    messages: room.messages.map((m) => ({
      id: m.id,
      type: m.type,
      content: tryParseJson(m.content),
      sender: m.sender,
      createdAt: m.createdAt,
    })),
    checkpoints: room.checkpoints.map((cp) => ({
      sequence: cp.sequence,
      progress: cp.progress,
      snapshot: tryParseJson(cp.snapshot),
      worker: cp.worker,
      createdAt: cp.createdAt,
    })),
  });
}

function tryParseJson(str: string): unknown {
  try { return JSON.parse(str); } catch { return str; }
}
