import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticateDrone, unauthorizedResponse } from "@/lib/auth";
import { hash } from "bcryptjs";
import { randomBytes } from "crypto";

function generateApiKey(): string {
  return "av_" + randomBytes(32).toString("base64url");
}

/**
 * POST /api/drones/regenerate-key
 *
 * Requires DID signature authentication.
 * Generates a new API Key for the authenticated drone,
 * invalidating the old one.
 */
export async function POST(request: NextRequest) {
  const auth = await authenticateDrone(request);
  if (!auth) {
    return unauthorizedResponse(
      "DID signature required. Use: Authorization: DID <did>;sig=<signature>;nonce=<timestamp>"
    );
  }

  if (auth.method !== "did") {
    return NextResponse.json(
      { error: "This endpoint requires DID signature authentication, not API Key." },
      { status: 403 }
    );
  }

  const apiKey = generateApiKey();
  const apiKeyPrefix = apiKey.slice(0, 11);
  const apiKeyHash = await hash(apiKey, 10);

  await prisma.drone.update({
    where: { id: auth.drone.id },
    data: { apiKeyPrefix, apiKeyHash },
  });

  return NextResponse.json({
    id: auth.drone.id,
    name: auth.drone.name,
    did: auth.drone.did,
    apiKey,
    message: "API Key regenerated. The old key is now invalid.",
  });
}
