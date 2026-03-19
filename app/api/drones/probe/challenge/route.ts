import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticateDrone, unauthorizedResponse } from "@/lib/auth";
import { generateChallenge, generateChallengeBatch, verifyResponse } from "@/lib/probe";

/**
 * POST /api/drones/probe/challenge — Platform sends a model identity probe challenge
 *
 * Request body:
 *   { "targetDroneId": "xxx", "probeType": "letter_count", "claimedModel": "claude-opus-4.6" }
 *
 * Returns a challenge that the target drone must respond to.
 * The response is then verified against known model fingerprints.
 */
export async function POST(request: NextRequest) {
  const auth = await authenticateDrone(request);
  if (!auth) return unauthorizedResponse();

  const body = await request.json();
  const { targetDroneId, probeType, claimedModel } = body;

  if (!targetDroneId) {
    return NextResponse.json(
      { error: "targetDroneId is required" },
      { status: 400 }
    );
  }

  const target = await prisma.drone.findUnique({
    where: { id: targetDroneId },
    include: { trustScore: true },
  });

  if (!target) {
    return NextResponse.json({ error: "Target drone not found" }, { status: 404 });
  }

  const challenge = generateChallenge(probeType || undefined);

  // Store the challenge (pending response)
  const probeResult = await prisma.probeResult.create({
    data: {
      droneId: targetDroneId,
      probeType: `identity_${challenge.type}`,
      challengeData: JSON.stringify(challenge),
      expectedModel: claimedModel || null,
      passed: false,
      confidence: 0,
    },
  });

  return NextResponse.json({
    probeId: probeResult.id,
    challenge: {
      id: challenge.id,
      type: challenge.type,
      prompt: challenge.prompt,
    },
    targetDroneId,
    claimedModel: claimedModel || null,
    note: "Send this challenge prompt to the target drone's LLM. Then POST the response to /api/drones/probe/challenge/verify with { probeId, response }.",
  }, { status: 201 });
}

/**
 * PUT /api/drones/probe/challenge — Submit probe response for verification
 *
 * Request body:
 *   { "probeId": "xxx", "response": "3" }
 *
 * Verifies the response against model fingerprints and updates TrustScore.
 */
export async function PUT(request: NextRequest) {
  const startMs = Date.now();
  const auth = await authenticateDrone(request);
  if (!auth) return unauthorizedResponse();

  const body = await request.json();
  const { probeId, response } = body;

  if (!probeId || !response) {
    return NextResponse.json(
      { error: "probeId and response are required" },
      { status: 400 }
    );
  }

  const probe = await prisma.probeResult.findUnique({
    where: { id: probeId },
  });

  if (!probe) {
    return NextResponse.json({ error: "Probe not found" }, { status: 404 });
  }

  if (probe.responseData) {
    return NextResponse.json({ error: "Probe already verified" }, { status: 409 });
  }

  const challenge = JSON.parse(probe.challengeData);
  const responseMs = Date.now() - startMs;

  // Verify the response against model fingerprints
  const verdict = verifyResponse(challenge, String(response), probe.expectedModel || undefined);

  // Update probe result
  await prisma.probeResult.update({
    where: { id: probeId },
    data: {
      responseData: JSON.stringify({ raw: response, verdict }),
      detectedModel: verdict.detectedFamily,
      confidence: verdict.confidence,
      passed: verdict.passed,
      responseMs,
    },
  });

  // Update TrustScore based on probe result
  const trust = await prisma.trustScore.findUnique({
    where: { droneId: probe.droneId },
  });

  if (trust) {
    // Adjust authenticityScore based on probe result
    const delta = verdict.passed ? 5 : -15; // Pass: small boost. Fail: significant penalty.
    const newAuthenticity = Math.max(0, Math.min(100, trust.authenticityScore + delta));
    const newTotal = trust.totalProbes + 1;
    const newPassRate = (trust.probePassRate * trust.totalProbes + (verdict.passed ? 1 : 0)) / newTotal;

    const overallScore = calculateOverallScore({
      probePassRate: newPassRate,
      taskCompletionRate: trust.taskCompletionRate,
      avgResponseMs: (trust.avgResponseMs * trust.totalProbes + responseMs) / newTotal,
      uptimeRatio: trust.uptimeRatio,
      authenticityScore: newAuthenticity,
    });

    await prisma.trustScore.update({
      where: { droneId: probe.droneId },
      data: {
        authenticityScore: newAuthenticity,
        totalProbes: newTotal,
        probePassRate: newPassRate,
        overallScore,
        lastCalculatedAt: new Date(),
      },
    });
  }

  return NextResponse.json({
    probeId,
    verdict: {
      detectedFamily: verdict.detectedFamily,
      confidence: verdict.confidence,
      passed: verdict.passed,
      reasoning: verdict.reasoning,
    },
    responseMs,
    trustScoreImpact: verdict.passed ? "+5 authenticity" : "-15 authenticity",
  });
}

/**
 * GET /api/drones/probe/challenge — Generate a batch of probe challenges (no storage)
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const count = Math.min(parseInt(searchParams.get("count") || "3"), 5);

  const challenges = generateChallengeBatch(count);

  return NextResponse.json({
    challenges: challenges.map(c => ({
      id: c.id,
      type: c.type,
      prompt: c.prompt,
    })),
    count: challenges.length,
    note: "Use POST /api/drones/probe/challenge to formally issue a challenge to a specific drone.",
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
