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

// ── URL Helpers ──────────────────────────────────────────────────

export function agentDescriptionUrl(droneId: string): string {
  return `${BASE_URL}/api/agents/${droneId}/ad`;
}
