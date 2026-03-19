import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticateDrone, unauthorizedResponse } from "@/lib/auth";
import { lockNectar } from "@/lib/nectar";

async function findBestWorker(publisherId: string, taskCategory: string | null) {
  // [R5-fix] Filter stale workers: only consider those with heartbeat within 30 minutes
  const heartbeatCutoff = new Date(Date.now() - 30 * 60 * 1000);

  const candidates = await prisma.drone.findMany({
    where: {
      id: { not: publisherId },
      status: { in: ["active", "unbonded"] },
      lastHeartbeat: { gte: heartbeatCutoff },
    },
    include: { trustScore: true },
    orderBy: { lastHeartbeat: "desc" },
    take: 20,
  });

  if (candidates.length === 0) return null;

  const scored = candidates.map((c) => {
    let score = 0;
    const trust = c.trustScore;

    if (trust) {
      score += trust.overallScore * 0.3;
      score += trust.taskCompletionRate * 20;
      score += (1 - Math.min(trust.avgResponseMs, 60000) / 60000) * 10;
      score += trust.uptimeRatio * 10;
    }

    if (taskCategory && c.capabilities) {
      try {
        const caps = JSON.parse(c.capabilities);
        if (caps.categories?.includes(taskCategory)) score += 15;
      } catch { /* ignore */ }
    }

    // [R5-fix] Stronger recency bonus: prioritize most-recently-active workers
    if (c.lastHeartbeat) {
      const minutesAgo = (Date.now() - c.lastHeartbeat.getTime()) / 60000;
      if (minutesAgo < 2) score += 15;
      else if (minutesAgo < 5) score += 10;
      else if (minutesAgo < 15) score += 5;
    }

    return { drone: c, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored[0].drone;
}

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

    const bestWorker = await findBestWorker(auth.drone.id, category || null);

    if (!bestWorker) {
      const task = await prisma.task.create({
        data: {
          title, description,
          publicPayload: publicPayload ? JSON.stringify(publicPayload) : null,
          estimatedTokens, lockedNectar: estimatedTokens,
          priority, category: category || null,
          status: "pending", publisherId: auth.drone.id,
        },
      });
      await lockNectar(auth.drone.id, task.id, estimatedTokens);

      return NextResponse.json({
        taskId: task.id,
        status: "pending",
        roomId: null,
        worker: null,
        lockedNectar: estimatedTokens,
        remainingNectar: auth.drone.nectar - estimatedTokens,
        note: "Task published but no available Worker found. Task remains pending; it will be assigned when a Worker becomes available. You can also manually assign via POST /api/tasks/:id/assign.",
      }, { status: 201 });
    }

    const result = await prisma.$transaction(async (tx) => {
      const task = await tx.task.create({
        data: {
          title, description,
          publicPayload: publicPayload ? JSON.stringify(publicPayload) : null,
          estimatedTokens, lockedNectar: estimatedTokens,
          priority, category: category || null,
          status: "accepted", publisherId: auth.drone.id,
          workerId: bestWorker.id, acceptedAt: new Date(),
        },
      });

      const room = await tx.room.create({
        data: { taskId: task.id, mode: "centralized", status: "active" },
      });

      await tx.workerAssignment.create({
        data: { taskId: task.id, workerId: bestWorker.id, status: "active" },
      });

      await tx.roomMessage.create({
        data: {
          roomId: room.id, senderId: auth.drone.id, type: "system",
          content: JSON.stringify({
            event: "worker_assigned",
            workerId: bestWorker.id,
            workerName: bestWorker.name,
            mode: "centralized",
            autoAssigned: true,
          }),
        },
      });

      return { task, room };
    });

    await lockNectar(auth.drone.id, result.task.id, estimatedTokens);

    return NextResponse.json({
      taskId: result.task.id,
      status: "accepted",
      roomId: result.room.id,
      worker: { id: bestWorker.id, name: bestWorker.name, did: bestWorker.did },
      lockedNectar: estimatedTokens,
      remainingNectar: auth.drone.nectar - estimatedTokens,
      note: "Task published and Worker auto-assigned. Room created. Send your task_payload to the Room now via POST /api/rooms/:roomId/messages.",
    }, { status: 201 });
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
  const excludeExpired = searchParams.get("excludeExpired") !== "false"; // default true

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: Record<string, any> = {};
  if (status) where.status = status;
  if (category) where.category = category;

  // [R7] Filter out stale pending tasks older than 4 hours by default
  if (excludeExpired && (!status || status === "pending")) {
    const expiryCutoff = new Date(Date.now() - 4 * 60 * 60 * 1000);
    if (status === "pending") {
      where.createdAt = { gte: expiryCutoff };
    } else if (!status) {
      // When listing all tasks, exclude expired pending ones
      where.OR = [
        { status: { not: "pending" } },
        { status: "pending", createdAt: { gte: expiryCutoff } },
      ];
    }
  }

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
    total: items.length,
  });
}
