import { NextRequest } from "next/server";
import { prisma } from "./prisma";
import { compare } from "bcryptjs";
import { Drone } from "@prisma/client";
import { parseDIDAuthHeader, verifyDIDSignature } from "./did";
import { authCache, droneCache } from "./cache";
import { checkRateLimit } from "./rate-limit";

export interface AuthResult {
  drone: Drone;
  method: "bearer" | "did";
}

/**
 * Authenticate a Drone via Authorization header.
 *
 * Supports two schemes:
 *   - Bearer av_xxx        → API Key (hashed lookup, cached)
 *   - DID did:wba:...;sig=...;nonce=...  → DID + ECDSA signature
 *
 * Performance: First request per agent per instance: ~10ms (bcrypt verify)
 *              Subsequent requests (cached): ~0.01ms
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

/**
 * Authenticate + rate limit in one call.
 * Returns null if auth fails, 429 result if rate limited.
 */
export async function authenticateAndRateLimit(
  request: NextRequest
): Promise<{ auth: AuthResult; rateLimited: false } | { auth: null; rateLimited: false } | { rateLimited: true; retryAfterMs: number }> {
  const auth = await authenticateDrone(request);
  if (!auth) return { auth: null, rateLimited: false };

  const rateCheck = checkRateLimit(auth.drone.id);
  if (!rateCheck.allowed) {
    return { rateLimited: true, retryAfterMs: rateCheck.retryAfterMs || 60000 };
  }

  return { auth, rateLimited: false };
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

  // Check cache first: avoids bcrypt.compare on every request
  const cached = authCache.get(prefix);
  if (cached) {
    // Verify the full key still matches (prevent prefix collision)
    const isValid = await compare(apiKey, cached.apiKeyHash);
    if (isValid) {
      // Fetch fresh drone data (might have updated nectar etc.)
      const drone = await prisma.drone.findUnique({
        where: { id: cached.droneId },
      });
      if (drone) return { drone, method: "bearer" };
    }
    // Cache entry invalid, remove it
    authCache.delete(prefix);
  }

  // Cache miss: do full DB lookup + bcrypt verify
  const drone = await prisma.drone.findUnique({
    where: { apiKeyPrefix: prefix },
  });
  if (!drone) return null;

  const isValid = await compare(apiKey, drone.apiKeyHash);
  if (!isValid) return null;

  // Cache the result for subsequent requests
  authCache.set(prefix, { droneId: drone.id, apiKeyHash: drone.apiKeyHash });

  return { drone, method: "bearer" };
}

export function unauthorizedResponse(message = "Unauthorized") {
  return new Response(JSON.stringify({ error: message }), {
    status: 401,
    headers: { "Content-Type": "application/json" },
  });
}

export function rateLimitedResponse(retryAfterMs: number) {
  return new Response(
    JSON.stringify({
      error: "Rate limit exceeded",
      retryAfterMs,
    }),
    {
      status: 429,
      headers: {
        "Content-Type": "application/json",
        "Retry-After": String(Math.ceil(retryAfterMs / 1000)),
      },
    }
  );
}
