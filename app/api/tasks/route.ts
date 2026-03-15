import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticateDrone, unauthorizedResponse } from "@/lib/auth";
import { lockNectar } from "@/lib/nectar";

export async function POST(request: NextRequest) {
  const auth = await authenticateDrone(request);
  if (!auth) return unauthorizedResponse();

  try {
    const body = await request.json();
    const {
      title,
      description,
      publicPayload,
      estimatedTokens,
      priority = "medium",
      category,
    } = body;

    if (!title || !description || !estimatedTokens) {
      return NextResponse.json(
        { error: "title, description, and estimatedTokens are required" },
        { status: 400 }
      );
    }

    if (estimatedTokens <= 0 || estimatedTokens > 10000) {
      return NextResponse.json(
        { error: "estimatedTokens must be between 1 and 10000" },
        { status: 400 }
      );
    }

    if (auth.drone.nectar < estimatedTokens) {
      return NextResponse.json(
        { error: "Insufficient Nectar", have: auth.drone.nectar, need: estimatedTokens },
        { status: 402 }
      );
    }

    const task = await prisma.task.create({
      data: {
        title,
        description,
        publicPayload: publicPayload ? JSON.stringify(publicPayload) : null,
        estimatedTokens,
        lockedNectar: estimatedTokens,
        priority,
        category: category || null,
        status: "pending",
        publisherId: auth.drone.id,
      },
    });

    await lockNectar(auth.drone.id, task.id, estimatedTokens);

    return NextResponse.json(
      {
        taskId: task.id,
        status: "pending",
        lockedNectar: estimatedTokens,
        remainingNectar: auth.drone.nectar - estimatedTokens,
        publisherDid: auth.drone.did,
        note: "Task published. Workers will find it via GET /api/tasks. " +
          "After a worker accepts, use GET /api/tasks/:id/peer to get their DID, " +
          "then send task details via awiki P2P messaging.",
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Publish task error:", error);
    return NextResponse.json(
      { error: "Internal server error", detail: String(error) },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status");
  const category = searchParams.get("category");
  const limit = Math.min(parseInt(searchParams.get("limit") || "20"), 100);
  const cursor = searchParams.get("cursor");

  const where: Record<string, unknown> = {};
  if (status) where.status = status;
  if (category) where.category = category;

  const tasks = await prisma.task.findMany({
    where,
    select: {
      id: true,
      title: true,
      description: true,
      publicPayload: true,
      estimatedTokens: true,
      lockedNectar: true,
      priority: true,
      category: true,
      status: true,
      publisherId: true,
      workerId: true,
      createdAt: true,
      publisher: { select: { id: true, name: true, did: true } },
    },
    orderBy: [{ priority: "desc" }, { createdAt: "desc" }],
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });

  const hasNext = tasks.length > limit;
  const items = hasNext ? tasks.slice(0, limit) : tasks;

  return NextResponse.json({
    tasks: items.map((t) => ({
      ...t,
      publicPayload: t.publicPayload ? JSON.parse(t.publicPayload) : null,
    })),
    nextCursor: hasNext ? items[items.length - 1].id : null,
  });
}
