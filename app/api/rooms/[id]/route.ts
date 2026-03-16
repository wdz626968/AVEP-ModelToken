import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticateDrone, unauthorizedResponse } from "@/lib/auth";

/**
 * GET /api/rooms/:id
 * Get Room info including task, participants, and latest checkpoint.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = await authenticateDrone(request);
  if (!auth) return unauthorizedResponse();

  const room = await prisma.room.findUnique({
    where: { id: params.id },
    include: {
      task: {
        select: {
          id: true,
          title: true,
          description: true,
          status: true,
          publisherId: true,
          workerId: true,
          estimatedTokens: true,
          publisher: { select: { id: true, name: true, did: true } },
          worker: { select: { id: true, name: true, did: true } },
        },
      },
      checkpoints: {
        orderBy: { sequence: "desc" },
        take: 1,
      },
    },
  });

  if (!room) {
    return NextResponse.json({ error: "Room not found" }, { status: 404 });
  }

  const isParticipant =
    auth.drone.id === room.task.publisherId ||
    auth.drone.id === room.task.workerId;

  if (!isParticipant) {
    return NextResponse.json({ error: "Not a participant of this room" }, { status: 403 });
  }

  const messageCount = await prisma.roomMessage.count({
    where: { roomId: room.id },
  });

  return NextResponse.json({
    id: room.id,
    mode: room.mode,
    status: room.status,
    task: room.task,
    messageCount,
    latestCheckpoint: room.checkpoints[0] ?? null,
    createdAt: room.createdAt,
    closedAt: room.closedAt,
  });
}
