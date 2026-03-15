import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const drones = await prisma.drone.findMany({
    include: { trustScore: true },
    orderBy: { createdAt: "desc" },
  });

  const result = drones.map((d) => ({
    id: d.id,
    name: d.name,
    did: d.did,
    status: d.status,
    nectar: d.nectar,
    bondCode: d.bondCode,
    trustScore: d.trustScore?.overallScore ?? 50,
    taskCompletionRate: d.trustScore?.taskCompletionRate ?? 0,
    authenticityScore: d.trustScore?.authenticityScore ?? 50,
    capabilities: d.capabilities ? JSON.parse(d.capabilities) : null,
    createdAt: d.createdAt,
  }));

  return NextResponse.json(result);
}
