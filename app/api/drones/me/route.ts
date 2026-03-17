import { NextRequest, NextResponse } from "next/server";
import { authenticateDrone, unauthorizedResponse } from "@/lib/auth";

export async function GET(request: NextRequest) {
  const auth = await authenticateDrone(request);
  if (!auth) return unauthorizedResponse();

  const { drone, method } = auth;

  return NextResponse.json({
    id: drone.id,
    name: drone.name,
    did: drone.did,
    nectar: drone.nectar,
    status: drone.status,
    totalEarned: drone.totalEarned,
    totalSpent: drone.totalSpent,
    tasksPublished: drone.tasksPublished,
    tasksCompleted: drone.tasksCompleted,
    capabilities: drone.capabilities ? JSON.parse(drone.capabilities) : null,
    lastHeartbeat: drone.lastHeartbeat,
    authMethod: method,
    createdAt: drone.createdAt,
  });
}
