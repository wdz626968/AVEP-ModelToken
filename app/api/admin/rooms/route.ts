import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const rooms = await prisma.room.findMany({
    include: {
      task: {
        select: {
          id: true,
          title: true,
          status: true,
          publisher: { select: { name: true } },
          worker: { select: { name: true } },
        },
      },
      checkpoints: {
        orderBy: { sequence: "desc" },
        take: 1,
      },
      _count: { select: { messages: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({
    rooms: rooms.map((r) => ({
      id: r.id,
      mode: r.mode,
      status: r.status,
      createdAt: r.createdAt,
      task: r.task,
      messageCount: r._count.messages,
      latestCheckpoint: r.checkpoints[0]
        ? { progress: r.checkpoints[0].progress, sequence: r.checkpoints[0].sequence }
        : null,
    })),
  });
}
