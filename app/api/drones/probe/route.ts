import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticateDrone, unauthorizedResponse } from "@/lib/auth";

/**
 * POST /api/drones/probe — Worker responds to a probe (health check)
 *
 * The platform periodically sends lightweight probes to verify worker liveness
 * and capability. Workers should respond as fast as possible.
 *
 * Body: { "challenge": "abc123" }
 * Response: { "response": "abc123", "capabilities": {...}, "load": 0.3 }
 *
 * Probe results feed into TrustScore:
 * - Response time → avgResponseMs
 * - Pass rate → probePassRate
 * - Uptime calculation → uptimeRatio
 */
export async function POST(request: NextRequest) {
  const startMs = Date.now();
  const auth = await authenticateDrone(request);
  if (!auth) return unauthorizedResponse();

  const body = await request.json();
  const { challenge } = body;

  if (!challenge) {
    return NextResponse.json(
      { error: "challenge is required" },
      { status: 400 }
    );
  }

  const responseMs = Date.now() - startMs;

  // Update TrustScore with probe result
  const trust = await prisma.trustScore.findUnique({
    where: { droneId: auth.drone.id },
  });

  if (trust) {
    const newTotal = trust.totalProbes + 1;
    const newPassRate = (trust.probePassRate * trust.totalProbes + 1) / newTotal;
    const newAvgMs =
      (trust.avgResponseMs * trust.totalProbes + responseMs) / newTotal;

    // Recalculate overall score
    const overallScore = calculateOverallScore({
      probePassRate: newPassRate,
      taskCompletionRate: trust.taskCompletionRate,
      avgResponseMs: newAvgMs,
      uptimeRatio: trust.uptimeRatio,
      authenticityScore: trust.authenticityScore,
    });

    await prisma.trustScore.update({
      where: { droneId: auth.drone.id },
      data: {
        totalProbes: newTotal,
        probePassRate: newPassRate,
        avgResponseMs: newAvgMs,
        overallScore,
        lastCalculatedAt: new Date(),
      },
    });
  }

  return NextResponse.json({
    response: challenge,
    probeResponseMs: responseMs,
    droneId: auth.drone.id,
    status: "healthy",
  });
}

/**
 * GET /api/drones/probe — Platform initiates a probe batch
 *
 * Called by admin/cron to trigger probes for stale workers.
 * Returns list of workers that should be probed.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const staleMinutes = parseInt(searchParams.get("staleMinutes") || "10");

  const cutoff = new Date(Date.now() - staleMinutes * 60 * 1000);

  // Find workers with active assignments but stale heartbeats
  const staleWorkers = await prisma.drone.findMany({
    where: {
      status: "active",
      OR: [
        { lastHeartbeat: { lt: cutoff } },
        { lastHeartbeat: null },
      ],
    },
    select: {
      id: true,
      name: true,
      did: true,
      lastHeartbeat: true,
      workerAssignments: {
        where: { status: "active" },
        select: { taskId: true },
      },
    },
    take: 50,
  });

  return NextResponse.json({
    staleWorkers: staleWorkers.map((w) => ({
      id: w.id,
      name: w.name,
      did: w.did,
      lastHeartbeat: w.lastHeartbeat,
      activeTaskCount: w.workerAssignments.length,
    })),
    total: staleWorkers.length,
    cutoffMinutes: staleMinutes,
  });
}

function calculateOverallScore(metrics: {
  probePassRate: number;
  taskCompletionRate: number;
  avgResponseMs: number;
  uptimeRatio: number;
  authenticityScore: number;
}): number {
  const speedScore = Math.max(0, 1 - metrics.avgResponseMs / 60000);
  return (
    metrics.probePassRate * 20 +
    metrics.taskCompletionRate * 25 +
    speedScore * 15 +
    metrics.uptimeRatio * 15 +
    metrics.authenticityScore * 0.25
  );
}
