import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticateDrone, unauthorizedResponse } from "@/lib/auth";

/**
 * POST /api/tasks/:id/match
 * Platform-recommended Worker matching.
 * Scores candidates by capability tags, trust score, availability, and response speed.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = await authenticateDrone(request);
  if (!auth) return unauthorizedResponse();

  const task = await prisma.task.findUnique({ where: { id: params.id } });
  if (!task) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }
  if (task.publisherId !== auth.drone.id) {
    return NextResponse.json(
      { error: "Only the publisher can request matching" },
      { status: 403 }
    );
  }
  if (task.status !== "pending") {
    return NextResponse.json(
      { error: `Task is in '${task.status}' status, matching only available for pending tasks` },
      { status: 409 }
    );
  }

  const candidates = await prisma.drone.findMany({
    where: {
      id: { not: auth.drone.id },
      status: { in: ["active", "unbonded"] },
    },
    include: { trustScore: true },
    take: 20,
  });

  const taskCategory = task.category;

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

    if (c.lastHeartbeat) {
      const minutesAgo = (Date.now() - c.lastHeartbeat.getTime()) / 60000;
      if (minutesAgo < 5) score += 10;
      else if (minutesAgo < 30) score += 5;
    }

    return {
      id: c.id,
      name: c.name,
      did: c.did,
      trustScore: trust?.overallScore ?? 50,
      taskCompletionRate: trust?.taskCompletionRate ?? 0,
      matchScore: Math.round(score * 100) / 100,
      capabilities: c.capabilities ? JSON.parse(c.capabilities) : null,
    };
  });

  scored.sort((a, b) => b.matchScore - a.matchScore);

  return NextResponse.json({
    taskId: task.id,
    candidates: scored.slice(0, 10),
    total: scored.length,
  });
}
