/**
 * DID utilities for AVEP.
 *
 * DID identities are created externally via awiki (https://awiki.ai/skill.md).
 * AVEP does NOT create or host DID Documents — it only resolves and
 * verifies them from the authoritative domain (e.g. awiki.ai).
 */

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000";

// ── DID Resolution ───────────────────────────────────────────────

export interface DIDDocument {
  "@context": unknown;
  id: string;
  verificationMethod?: Array<{
    id: string;
    type: string;
    controller: string;
    publicKeyJwk?: Record<string, string>;
    publicKeyMultibase?: string;
  }>;
  authentication?: string[];
  keyAgreement?: string[];
  service?: Array<{
    id: string;
    type: string;
    serviceEndpoint: string;
  }>;
  proof?: Record<string, unknown>;
  [key: string]: unknown;
}

/**
 * Resolve a did:wba DID to its DID Document by fetching from the
 * authoritative domain. Follows the did:wba spec: the DID encodes
 * the HTTPS URL where the document is hosted.
 *
 * did:wba:awiki.ai:user:abc123
 *   → https://awiki.ai/user/abc123/did.json
 *
 * did:wba:awiki.ai:alice:k1_abc123
 *   → https://awiki.ai/alice/k1_abc123/did.json
 */
export async function resolveDIDDocument(
  did: string
): Promise<DIDDocument | null> {
  const url = didToDocumentUrl(did);
  if (!url) return null;

  try {
    const res = await fetch(url, {
      headers: { Accept: "application/did+ld+json, application/json" },
      next: { revalidate: 300 },
    });
    if (!res.ok) return null;
    const doc: DIDDocument = await res.json();
    if (doc.id !== did) return null;
    return doc;
  } catch {
    return null;
  }
}

/**
 * Convert a did:wba identifier to the HTTPS URL of its DID Document.
 *
 * did:wba:domain:path1:path2:...
 *   → https://domain/path1/path2/.../did.json
 *
 * Colons in path segments replace forward slashes per the did:wba spec.
 */
export function didToDocumentUrl(did: string): string | null {
  const parsed = parseDID(did);
  if (!parsed) return null;
  const { domain, pathSegments } = parsed;
  const path = pathSegments.join("/");
  return `https://${domain}/${path}/did.json`;
}

// ── DID Parsing ──────────────────────────────────────────────────

export interface ParsedDID {
  method: string;
  domain: string;
  pathSegments: string[];
}

/**
 * Parse a did:wba string into its components.
 * Supports arbitrary path depth: did:wba:domain:seg1:seg2:...
 */
export function parseDID(did: string): ParsedDID | null {
  const parts = did.split(":");
  // Minimum: did:wba:domain:seg1 (4 parts)
  if (parts.length < 4 || parts[0] !== "did" || parts[1] !== "wba") {
    return null;
  }
  return {
    method: parts[1],
    domain: parts[2],
    pathSegments: parts.slice(3),
  };
}

/**
 * Validate that a DID string looks well-formed (does NOT resolve it).
 */
export function isValidDIDFormat(did: string): boolean {
  if (!did || typeof did !== "string") return false;
  const parsed = parseDID(did);
  if (!parsed) return false;
  if (!parsed.domain || parsed.pathSegments.length === 0) return false;
  return true;
}

// ── DID Signature Verification ───────────────────────────────────

/**
 * Parse a DID Authorization header value.
 *
 * Format: DID <did>;sig=<base64url>;nonce=<timestamp>
 *
 * Returns null if the format is invalid.
 */
export interface DIDAuthParams {
  did: string;
  signature: string; // base64url-encoded
  nonce: string;     // timestamp string
}

export function parseDIDAuthHeader(headerValue: string): DIDAuthParams | null {
  // Expected: "DID did:wba:domain:path;sig=xxxxx;nonce=xxxxx"
  if (!headerValue.startsWith("DID ")) return null;

  const rest = headerValue.slice(4);
  const parts = rest.split(";");
  if (parts.length < 3) return null;

  const did = parts[0].trim();
  if (!did.startsWith("did:")) return null;

  const params: Record<string, string> = {};
  for (let i = 1; i < parts.length; i++) {
    const eq = parts[i].indexOf("=");
    if (eq === -1) return null;
    params[parts[i].slice(0, eq).trim()] = parts[i].slice(eq + 1).trim();
  }

  if (!params.sig || !params.nonce) return null;

  return { did, signature: params.sig, nonce: params.nonce };
}

const NONCE_MAX_AGE_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Verify an ECDSA P-256 signature produced by a DID holder.
 *
 * The signed payload is: `{method}|{url}|{nonce}`
 * (matching the did:wba authentication spec from SYSTEM_DESIGN).
 *
 * @param publicKeyJwk - The JWK from the Drone's stored publicKeyJwk
 * @param signature    - base64url-encoded ECDSA signature
 * @param method       - HTTP method (GET, POST, …)
 * @param url          - Full request URL
 * @param nonce        - Timestamp nonce string
 */
export async function verifyDIDSignature(
  publicKeyJwk: JsonWebKey,
  signature: string,
  method: string,
  url: string,
  nonce: string
): Promise<boolean> {
  // Reject stale nonces
  const nonceTs = Number(nonce);
  if (Number.isNaN(nonceTs) || Math.abs(Date.now() - nonceTs) > NONCE_MAX_AGE_MS) {
    return false;
  }

  try {
    const key = await crypto.subtle.importKey(
      "jwk",
      publicKeyJwk,
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"]
    );

    const payload = `${method}|${url}|${nonce}`;
    const data = new TextEncoder().encode(payload);

    const sigBytes = base64urlDecode(signature);

    return await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      key,
      sigBytes.buffer as ArrayBuffer,
      data
    );
  } catch {
    return false;
  }
}

function base64urlDecode(input: string): Uint8Array {
  const base64 = input.replace(/-/g, "+").replace(/_/g, "/");
  const pad = base64.length % 4;
  const padded = pad ? base64 + "=".repeat(4 - pad) : base64;
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// ── URL Helpers ──────────────────────────────────────────────────

export function agentDescriptionUrl(droneId: string): string {
  return `${BASE_URL}/api/agents/${droneId}/ad`;
}
