import { NextRequest } from "next/server";
import { prisma } from "./prisma";
import { compare } from "bcryptjs";
import { Drone } from "@prisma/client";
import { parseDIDAuthHeader, verifyDIDSignature } from "./did";

export interface AuthResult {
  drone: Drone;
  method: "bearer" | "did";
}

/**
 * Authenticate a Drone via Authorization header.
 *
 * Supports two schemes:
 *   - Bearer av_xxx        → API Key (hashed lookup)
 *   - DID did:wba:...;sig=...;nonce=...  → DID + ECDSA signature
 */
export async function authenticateDrone(
  request: NextRequest
): Promise<AuthResult | null> {
  const authHeader = request.headers.get("authorization");
  if (!authHeader) return null;

  if (authHeader.startsWith("DID ")) {
    return authenticateWithDIDSignature(authHeader, request);
  }

  if (authHeader.startsWith("Bearer ")) {
    const token = authHeader.slice(7).trim();
    if (token.startsWith("av_")) {
      return authenticateWithApiKey(token);
    }
  }

  return null;
}

async function authenticateWithDIDSignature(
  authHeader: string,
  request: NextRequest
): Promise<AuthResult | null> {
  const params = parseDIDAuthHeader(authHeader);
  if (!params) return null;

  const drone = await prisma.drone.findFirst({
    where: { did: params.did },
  });
  if (!drone || !drone.publicKeyJwk) return null;

  let jwk: JsonWebKey;
  try {
    jwk = JSON.parse(drone.publicKeyJwk);
  } catch {
    return null;
  }

  const valid = await verifyDIDSignature(
    jwk,
    params.signature,
    request.method,
    request.url,
    params.nonce
  );
  if (!valid) return null;

  return { drone, method: "did" };
}

async function authenticateWithApiKey(
  apiKey: string
): Promise<AuthResult | null> {
  const prefix = apiKey.slice(0, 11);
  const drone = await prisma.drone.findUnique({
    where: { apiKeyPrefix: prefix },
  });
  if (!drone) return null;

  const isValid = await compare(apiKey, drone.apiKeyHash);
  if (!isValid) return null;

  return { drone, method: "bearer" };
}

export function unauthorizedResponse(message = "Unauthorized") {
  return new Response(JSON.stringify({ error: message }), {
    status: 401,
    headers: { "Content-Type": "application/json" },
  });
}
