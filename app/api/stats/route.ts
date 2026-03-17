import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const [pending, active, completed, agents] = await Promise.all([
    prisma.task.count({ where: { status: "pending" } }),
    prisma.task.count({ where: { status: "accepted" } }),
    prisma.task.count({ where: { status: { in: ["completed", "settled"] } } }),
    prisma.drone.count(),
  ]);

  return NextResponse.json({ pending, active, completed, agents });
}
