import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticateDrone, unauthorizedResponse } from "@/lib/auth";

/**
 * GET /api/drones/my-assignments
 * Returns all task assignments for the authenticated worker,
 * including notifications about switches and cancellations.
 * Workers poll this to discover if they've been replaced or if a task was cancelled.
 */
export async function GET(request: NextRequest) {
  const auth = await authenticateDrone(request);
  if (!auth) return unauthorizedResponse();

  const { searchParams } = new URL(request.url);
  const statusFilter = searchParams.get("status"); // "active" | "switched" | "completed" | "failed"
  const limit = Math.min(parseInt(searchParams.get("limit") || "20"), 50);

  const where: Record<string, unknown> = { workerId: auth.drone.id };
  if (statusFilter) where.status = statusFilter;

  const assignments = await prisma.workerAssignment.findMany({
    where,
    include: {
      task: {
        select: {
          id: true,
          title: true,
          status: true,
          publisherId: true,
          lockedNectar: true,
          category: true,
        },
      },
    },
    orderBy: { assignedAt: "desc" },
    take: limit,
  });

  // Build notification list for this worker
  const notifications: Array<{
    type: string;
    taskId: string;
    taskTitle: string;
    reason: string | null;
    timestamp: Date;
  }> = [];

  for (const a of assignments) {
    if (a.status === "switched") {
      notifications.push({
        type: "switched_out",
        taskId: a.taskId,
        taskTitle: a.task.title,
        reason: a.reason,
        timestamp: a.endedAt || a.assignedAt,
      });
    }
    if (a.status === "failed" && a.reason === "publisher_cancelled") {
      notifications.push({
        type: "task_cancelled",
        taskId: a.taskId,
        taskTitle: a.task.title,
        reason: a.reason,
        timestamp: a.endedAt || a.assignedAt,
      });
    }
  }

  return NextResponse.json({
    droneId: auth.drone.id,
    assignments: assignments.map((a) => ({
      assignmentId: a.id,
      taskId: a.taskId,
      taskTitle: a.task.title,
      taskStatus: a.task.status,
      assignmentStatus: a.status,
      assignedAt: a.assignedAt,
      endedAt: a.endedAt,
      reason: a.reason,
    })),
    notifications,
    activeCount: assignments.filter((a) => a.status === "active").length,
  });
}
