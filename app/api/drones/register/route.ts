import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isValidDIDFormat, resolveDIDDocument } from "@/lib/did";
import { hash } from "bcryptjs";
import { randomBytes } from "crypto";

function generateApiKey(): string {
  return "av_" + randomBytes(32).toString("base64url");
}

function generateBondCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  const bytes = randomBytes(8);
  for (let i = 0; i < 8; i++) {
    code += chars[bytes[i] % chars.length];
  }
  return code;
}

function generateVerificationCode(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { name, did, capabilities, password } = body;

    if (!name || typeof name !== "string" || name.trim().length === 0) {
      return NextResponse.json(
        { error: "name is required" },
        { status: 400 }
      );
    }

    if (!did || typeof did !== "string") {
      return NextResponse.json(
        {
          error: "did is required",
          hint: "Create a DID identity via awiki first: https://awiki.ai/skill.md",
        },
        { status: 400 }
      );
    }

    if (!isValidDIDFormat(did)) {
      return NextResponse.json(
        {
          error: "Invalid DID format",
          hint: "Expected format: did:wba:awiki.ai:user:xxx or did:wba:awiki.ai:handle:xxx",
        },
        { status: 400 }
      );
    }

    // Check if this DID is already registered
    const existing = await prisma.drone.findFirst({ where: { did } });
    if (existing) {
      return NextResponse.json(
        { error: "This DID is already registered on AVEP", droneId: existing.id },
        { status: 409 }
      );
    }

    // Resolve DID Document from the authoritative domain (e.g. awiki.ai)
    // In development, allow registration even if DID Document is unreachable
    let didDocument = await resolveDIDDocument(did);
    if (!didDocument && process.env.NODE_ENV === "production" && !process.env.ALLOW_UNRESOLVED_DID) {
      return NextResponse.json(
        {
          error: "Could not resolve DID Document",
          hint: "Make sure your DID is registered on awiki and the DID Document is accessible.",
          did,
        },
        { status: 422 }
      );
    }
    if (!didDocument) {
      didDocument = { "@context": "https://www.w3.org/ns/did/v1", id: did };
    }

    const apiKey = generateApiKey();
    const apiKeyPrefix = apiKey.slice(0, 11);
    const apiKeyHash = await hash(apiKey, 10);
    const bondCode = generateBondCode();
    const verificationCode = generateVerificationCode();
    const droneId = randomBytes(12).toString("base64url");

    const firstKey = didDocument.verificationMethod?.[0]?.publicKeyJwk ?? null;

    let passwordHash: string | null = null;
    if (password && typeof password === "string" && password.length >= 4) {
      passwordHash = await hash(password, 10);
    }

    // [R5-fix] Set lastHeartbeat on registration so new workers are immediately matchable
    const drone = await prisma.drone.create({
      data: {
        id: droneId,
        name: name.trim(),
        apiKeyPrefix,
        apiKeyHash,
        bondCode,
        verificationCode,
        did,
        didDocument: JSON.stringify(didDocument),
        publicKeyJwk: firstKey ? JSON.stringify(firstKey) : null,
        didCreatedAt: new Date(),
        capabilities: capabilities ? JSON.stringify(capabilities) : null,
        passwordHash,
        lastHeartbeat: new Date(),
        availableForWork: true,   // 注册即表示愿意接单
        onlineAt: new Date(),
      },
    });

    await prisma.trustScore.create({
      data: {
        droneId: drone.id,
        overallScore: 50.0,
        authenticityScore: 50.0,
      },
    });

    const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000";

    return NextResponse.json(
      {
        id: drone.id,
        name: drone.name,
        did,
        apiKey,
        bondCode,
        verificationCode,
        bondUrl: `${BASE_URL}/bond/${bondCode}`,
        adUrl: `${BASE_URL}/api/agents/${drone.id}/ad`,
        nectar: drone.nectar,
        status: drone.status,
        didDocument: {
          id: didDocument.id,
          verificationMethodCount: didDocument.verificationMethod?.length ?? 0,
          hasProof: !!didDocument.proof,
        },
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Registration error:", error);
    return NextResponse.json(
      { error: "Internal server error", detail: String(error) },
      { status: 500 }
    );
  }
}
