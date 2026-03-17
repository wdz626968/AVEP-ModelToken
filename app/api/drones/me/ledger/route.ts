import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticateDrone, unauthorizedResponse } from "@/lib/auth";

export async function GET(request: NextRequest) {
  const auth = await authenticateDrone(request);
  if (!auth) return unauthorizedResponse();

  const { searchParams } = new URL(request.url);
  const limit = Math.min(parseInt(searchParams.get("limit") || "20"), 100);
  const cursor = searchParams.get("cursor");

  const entries = await prisma.nectarLedger.findMany({
    where: { droneId: auth.drone.id },
    orderBy: { createdAt: "desc" },
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    include: {
      task: { select: { id: true, title: true } },
    },
  });

  const hasNext = entries.length > limit;
  const items = hasNext ? entries.slice(0, limit) : entries;

  return NextResponse.json({
    entries: items,
    nextCursor: hasNext ? items[items.length - 1].id : null,
  });
}
