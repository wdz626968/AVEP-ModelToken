import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticateDrone, unauthorizedResponse } from "@/lib/auth";
import { fetchScoredCandidates } from "@/lib/matching";

/**
 * POST /api/tasks/:id/match
 * Returns a scored candidate list for a pending task.
 * Uses the same scoring engine as auto-match — preview results are 1:1 consistent
 * with what the platform would actually assign (v2 fix).
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

  const candidates = await fetchScoredCandidates({
    category: task.category,
    priority: (task.priority as "high" | "medium" | "low") ?? "medium",
    estimatedTokens: task.estimatedTokens,
    publisherId: auth.drone.id,
  });

  return NextResponse.json({
    taskId: task.id,
    candidates: candidates.slice(0, 10).map((c) => ({
      id: c.drone.id,
      name: c.drone.name,
      did: c.drone.did,
      trustScore: c.drone.trustScore?.overallScore ?? 50,
      taskCompletionRate: c.drone.trustScore?.taskCompletionRate ?? 0,
      matchScore: c.matchScore,
      activeTaskCount: c.activeTaskCount,
      maxConcurrentTasks: c.maxConcurrentTasks,
      scoreBreakdown: c.scoreBreakdown,
      capabilities: c.drone.capabilities ? JSON.parse(c.drone.capabilities) : null,
    })),
    total: candidates.length,
  });
}
