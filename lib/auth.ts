import { NextRequest } from "next/server";
import { prisma } from "./prisma";
import { compare } from "bcryptjs";
import { Drone } from "@prisma/client";

export interface AuthResult {
  drone: Drone;
  method: "bearer";
}

/**
 * Authenticate a Drone via Bearer token (API Key).
 *
 * DID:WBA identity is used for registration and cross-platform discovery,
 * but HiveGrid API calls use Bearer tokens for simplicity.
 * The DID is the Drone's portable identity; the API Key is its HiveGrid session key.
 */
export async function authenticateDrone(
  request: NextRequest
): Promise<AuthResult | null> {
  const authHeader = request.headers.get("authorization");
  if (!authHeader) return null;

  if (authHeader.startsWith("Bearer ")) {
    return authenticateWithBearer(authHeader);
  }

  return null;
}

async function authenticateWithBearer(
  authHeader: string
): Promise<AuthResult | null> {
  const apiKey = authHeader.slice(7);
  if (!apiKey || !apiKey.startsWith("hg_")) return null;

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
