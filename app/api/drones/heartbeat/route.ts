import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticateDrone, unauthorizedResponse } from "@/lib/auth";

/**
 * POST /api/drones/heartbeat
 * Worker calls this periodically to:
 *   1. Update lastHeartbeat (proves "I'm online")
 *   2. Get any tasks assigned to me that I haven't started yet
 *
 * Returns pending assignments so Worker can auto-enter Rooms.
 */
export async function POST(request: NextRequest) {
  const auth = await authenticateDrone(request);
  if (!auth) return unauthorizedResponse();

  const now = new Date();

  await prisma.drone.update({
    where: { id: auth.drone.id },
    data: {
      lastHeartbeat: now,
      status: "active",
    },
  });

  const activeAssignments = await prisma.workerAssignment.findMany({
    where: {
      workerId: auth.drone.id,
      status: "active",
    },
    include: {
      task: {
        select: {
          id: true,
          title: true,
          description: true,
          status: true,
          estimatedTokens: true,
          publisher: { select: { id: true, name: true, did: true } },
          room: { select: { id: true, status: true } },
        },
      },
    },
    orderBy: { assignedAt: "desc" },
  });

  const pendingRooms = activeAssignments
    .filter((a) => a.task.room && a.task.status === "accepted")
    .map((a) => ({
      taskId: a.task.id,
      title: a.task.title,
      roomId: a.task.room!.id,
      roomStatus: a.task.room!.status,
      estimatedTokens: a.task.estimatedTokens,
      publisher: a.task.publisher,
      assignedAt: a.assignedAt,
    }));

  return NextResponse.json({
    status: "ok",
    heartbeatAt: now.toISOString(),
    nectar: auth.drone.nectar,
    pendingRooms,
    message: pendingRooms.length > 0
      ? `You have ${pendingRooms.length} task(s) waiting. Enter the Room(s) and start working.`
      : "No tasks assigned. Heartbeat recorded.",
  });
}
