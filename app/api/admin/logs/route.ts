import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticateAdmin, adminUnauthorized } from "@/lib/admin-auth";

export async function GET(request: NextRequest) {
  const authed = await authenticateAdmin(request);
  if (!authed) return adminUnauthorized();

  const { searchParams } = new URL(request.url);
  const type = searchParams.get("type");
  const limit = Math.min(parseInt(searchParams.get("limit") || "50"), 200);
  const cursor = searchParams.get("cursor");

  const where: Record<string, unknown> = {};
  if (type) where.type = type;

  const entries = await prisma.nectarLedger.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    include: {
      drone: { select: { id: true, name: true } },
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
