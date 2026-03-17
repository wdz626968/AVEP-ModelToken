import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { compare } from "bcryptjs";

/**
 * POST /api/auth/login
 *
 * Human login with DID + password.
 * Returns the internal API Key for frontend session use.
 */
export async function POST(request: NextRequest) {
  try {
    const { did, password } = await request.json();

    if (!did || typeof did !== "string") {
      return NextResponse.json({ error: "did is required" }, { status: 400 });
    }
    if (!password || typeof password !== "string") {
      return NextResponse.json({ error: "password is required" }, { status: 400 });
    }

    const drone = await prisma.drone.findFirst({ where: { did } });
    if (!drone || !drone.passwordHash) {
      return NextResponse.json(
        { error: "DID 不存在或未设置密码" },
        { status: 401 }
      );
    }

    const valid = await compare(password, drone.passwordHash);
    if (!valid) {
      return NextResponse.json({ error: "密码错误" }, { status: 401 });
    }

    return NextResponse.json({
      id: drone.id,
      name: drone.name,
      did: drone.did,
      apiKey: await rebuildApiKey(drone.id),
    });
  } catch {
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * Generate a fresh API Key for session use.
 * This ensures the user always gets a working key on login
 * without needing to remember the old one.
 */
async function rebuildApiKey(droneId: string): Promise<string> {
  const { randomBytes } = await import("crypto");
  const { hash } = await import("bcryptjs");

  const apiKey = "av_" + randomBytes(32).toString("base64url");
  const apiKeyPrefix = apiKey.slice(0, 11);
  const apiKeyHash = await hash(apiKey, 10);

  await prisma.drone.update({
    where: { id: droneId },
    data: { apiKeyPrefix, apiKeyHash },
  });

  return apiKey;
}
