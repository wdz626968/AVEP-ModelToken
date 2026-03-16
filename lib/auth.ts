import { NextRequest } from "next/server";
import { prisma } from "./prisma";
import { compare } from "bcryptjs";
import { Drone } from "@prisma/client";

export interface AuthResult {
  drone: Drone;
  method: "bearer" | "did";
}

/**
 * Authenticate a Drone via Bearer token.
   * Supports two schemes:
   *   - Bearer av_xxx  → API Key (legacy)
   *   - Bearer did:wba:... → DID-based lookup
 */
export async function authenticateDrone(
  request: NextRequest
): Promise<AuthResult | null> {
  const authHeader = request.headers.get("authorization");
  if (!authHeader) return null;

  if (authHeader.startsWith("Bearer ")) {
    const token = authHeader.slice(7).trim();
    if (token.startsWith("did:")) {
      return authenticateWithDID(token);
    }
    if (token.startsWith("av_")) {
      return authenticateWithApiKey(token);
    }
  }

  return null;
}

async function authenticateWithDID(
  did: string
): Promise<AuthResult | null> {
  const drone = await prisma.drone.findFirst({ where: { did } });
  if (!drone) return null;
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
