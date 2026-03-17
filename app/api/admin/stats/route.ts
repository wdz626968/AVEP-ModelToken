import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticateAdmin, adminUnauthorized } from "@/lib/admin-auth";

export async function GET(request: NextRequest) {
  const authed = await authenticateAdmin(request);
  if (!authed) return adminUnauthorized();

  const [
    totalTasks,
    pending,
    active,
    completed,
    settled,
    cancelled,
    totalAgents,
    totalRooms,
    activeRooms,
  ] = await Promise.all([
    prisma.task.count(),
    prisma.task.count({ where: { status: "pending" } }),
    prisma.task.count({ where: { status: "accepted" } }),
    prisma.task.count({ where: { status: "completed" } }),
    prisma.task.count({ where: { status: "settled" } }),
    prisma.task.count({ where: { status: "cancelled" } }),
    prisma.drone.count(),
    prisma.room.count(),
    prisma.room.count({ where: { status: "active" } }),
  ]);

  return NextResponse.json({
    tasks: { total: totalTasks, pending, active, completed, settled, cancelled },
    agents: totalAgents,
    rooms: { total: totalRooms, active: activeRooms },
  });
}
