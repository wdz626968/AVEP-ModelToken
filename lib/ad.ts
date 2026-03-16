import { Drone, TrustScore } from "@prisma/client";
import { didToDocumentUrl, agentDescriptionUrl } from "./did";

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000";

type DroneWithTrust = Drone & { trustScore: TrustScore | null };

function parseJsonField(value: string | null): unknown {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

export function buildAgentDescription(drone: DroneWithTrust) {
  const did = drone.did || `unknown:${drone.id}`;
  const capabilities = parseJsonField(drone.capabilities) as {
    models?: string[];
    contextLength?: number;
    tools?: string[];
  } | null;
  const preferences = parseJsonField(drone.preferences) as {
    categories?: string[];
  } | null;

  return {
    "@context": {
      "@vocab": "https://schema.org/",
      did: "https://w3id.org/did#",
      ad: "https://agent-network-protocol.com/ad#",
    },
    "@type": "ad:AgentDescription",
    "@id": agentDescriptionUrl(drone.id),
    name: drone.name,
    did,
    description: `AVEP Agent node — ${drone.name}`,
    version: "1.0.0",
    created: drone.createdAt.toISOString(),
    modified: drone.updatedAt.toISOString(),
    owner: {
      "@type": "Organization",
      name: "AVEP Network",
      "@id": BASE_URL,
    },
    securityDefinitions: {
      didwba_sc: {
        scheme: "didwba",
        in: "header",
        name: "Authorization",
      },
    },
    security: "didwba_sc",
    additionalProperty: [
      {
        "@type": "PropertyValue",
        name: "ad:availability",
        value: drone.status === "active" ? "available" : "unavailable",
      },
      {
        "@type": "PropertyValue",
        name: "ad:trustScore",
        value: drone.trustScore?.overallScore ?? 50.0,
      },
      {
        "@type": "PropertyValue",
        name: "ad:taskCompletionRate",
        value: drone.trustScore?.taskCompletionRate ?? 0.0,
      },
      {
        "@type": "PropertyValue",
        name: "ad:supportedModels",
        value: capabilities?.models ?? [],
      },
      {
        "@type": "PropertyValue",
        name: "ad:contextLength",
        value: capabilities?.contextLength ?? 0,
      },
      {
        "@type": "PropertyValue",
        name: "ad:supportedTools",
        value: capabilities?.tools ?? [],
      },
      {
        "@type": "PropertyValue",
        name: "ad:taskCategories",
        value: preferences?.categories ?? [],
      },
    ],
    interfaces: [
      {
        "@type": "ad:NaturalLanguageInterface",
        name: "taskNegotiation",
        protocol: "YAML",
        url: `${BASE_URL}/api/agents/${drone.id}/interfaces/task-negotiation`,
        description:
          "Negotiate task requirements, assess feasibility, and confirm acceptance via natural language",
      },
      {
        "@type": "ad:StructuredInterface",
        name: "avepTaskProtocol",
        protocol: "JSON-RPC 2.0",
        url: `${BASE_URL}/protocols/avep-task-v1.json`,
        description:
          "AVEP standard task lifecycle protocol — publish/match/assign/execute/complete",
      },
    ],
    didDocument: did ? didToDocumentUrl(did) : null,
  };
}
