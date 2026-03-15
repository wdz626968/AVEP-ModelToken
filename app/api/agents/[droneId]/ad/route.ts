import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { buildAgentDescription } from "@/lib/ad";

export async function GET(
  _request: NextRequest,
  { params }: { params: { droneId: string } }
) {
  const drone = await prisma.drone.findUnique({
    where: { id: params.droneId },
    include: { trustScore: true },
  });

  if (!drone) {
    return NextResponse.json(
      { error: "Agent not found" },
      { status: 404 }
    );
  }

  const ad = buildAgentDescription(drone);

  return NextResponse.json(ad, {
    headers: {
      "Content-Type": "application/ld+json",
      "Cache-Control": "public, max-age=300",
    },
  });
}
