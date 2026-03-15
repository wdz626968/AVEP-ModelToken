import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000";
const PAGE_SIZE = 50;

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
  const skip = (page - 1) * PAGE_SIZE;

  const [drones, total] = await Promise.all([
    prisma.drone.findMany({
      where: {
        did: { not: null },
      },
      select: {
        id: true,
        name: true,
        did: true,
      },
      orderBy: { createdAt: "desc" },
      take: PAGE_SIZE,
      skip,
    }),
    prisma.drone.count({
      where: {
        did: { not: null },
      },
    }),
  ]);

  const hasNext = skip + PAGE_SIZE < total;

  const response: Record<string, unknown> = {
    "@context": {
      "@vocab": "https://schema.org/",
      ad: "https://agent-network-protocol.com/ad#",
    },
    "@type": "CollectionPage",
    url: `${BASE_URL}/api/well-known/agent-descriptions${page > 1 ? `?page=${page}` : ""}`,
    totalItems: total,
    items: drones.map((d) => ({
      "@type": "ad:AgentDescription",
      name: d.name,
      did: d.did,
      "@id": `${BASE_URL}/api/agents/${d.id}/ad`,
    })),
  };

  if (hasNext) {
    response.next = `${BASE_URL}/api/well-known/agent-descriptions?page=${page + 1}`;
  }

  return NextResponse.json(response, {
    headers: {
      "Content-Type": "application/ld+json",
      "Cache-Control": "public, max-age=60",
    },
  });
}
