import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticateDrone, unauthorizedResponse } from "@/lib/auth";
import { tryAssignPendingTasksToWorker } from "@/lib/matching";
import { sendAnpMessage } from "@/lib/anp";

/**
 * POST /api/drones/heartbeat
 *
 * 保活心跳：证明"我在线"，返回当前活跃任务列表。
 *
 * 新设计（ANP 推单模式）：
 *   - 心跳只做两件事：更新 lastHeartbeat + 返回 pendingRooms
 *   - 不再做 auto-match：新任务到来时撮合引擎通过 ANP 主动推给 Worker
 *   - 如果 Worker 长时间不发心跳（>10分钟），撮合引擎将其视为离线
 *
 * Body (optional):
 *   { "availableForWork": true, "capabilities": {...} }
 */
export async function POST(request: NextRequest) {
  const auth = await authenticateDrone(request);
  if (!auth) return unauthorizedResponse();

  const now = new Date();

  let capabilities: string | undefined;
  let availableForWork: boolean | undefined;
  try {
    const body = await request.json();
    if (body.capabilities) {
      capabilities = typeof body.capabilities === "string"
        ? body.capabilities
        : JSON.stringify(body.capabilities);
    }
    if (typeof body.availableForWork === "boolean") {
      availableForWork = body.availableForWork;
    }
  } catch {
    // heartbeat without body is fine
  }

  // 更新心跳时间 + 可选字段
  const updateData: Record<string, unknown> = {
    lastHeartbeat: now,
    status: "active",
  };
  if (capabilities !== undefined) updateData.capabilities = capabilities;
  // 如果明确传了 availableForWork，更新在线意愿
  if (availableForWork !== undefined) {
    updateData.availableForWork = availableForWork;
    if (availableForWork) updateData.onlineAt = now;
  }

  await prisma.drone.update({
    where: { id: auth.drone.id },
    data: updateData,
  });

  // 补撮合触发条件：
  //   1. 本次心跳显式声明 availableForWork=true（首次上线）
  //   2. 或 Worker 本身已是 availableForWork=true，且当前活跃任务 < maxConcurrentTasks
  //      （每次心跳都检查，确保有空槽时持续承接积压任务）
  const effectiveAvailable = availableForWork ?? auth.drone.availableForWork;
  if (effectiveAvailable) {
    setImmediate(async () => {
      try {
        // 轻量预检：有空槽且存在 pending 任务才触发，避免无谓数据库查询
        const [activeCount, pendingCount] = await Promise.all([
          prisma.workerAssignment.count({
            where: { workerId: auth.drone.id, status: "active" },
          }),
          prisma.task.count({ where: { status: "pending" } }),
        ]);

        let maxConcurrent = 3;
        const capStr = capabilities ?? auth.drone.capabilities ?? null;
        if (capStr) {
          try {
            const caps = JSON.parse(capStr);
            if (typeof caps.maxConcurrentTasks === "number" && caps.maxConcurrentTasks >= 1) {
              maxConcurrent = Math.min(Math.floor(caps.maxConcurrentTasks), 10);
            }
          } catch { /* ignore */ }
        }

        if (activeCount < maxConcurrent && pendingCount > 0) {
          await tryAssignPendingTasksToWorker(
            auth.drone.id,
            async (toDid, payload) => {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              await sendAnpMessage(toDid, payload as any);
            }
          );
        }
      } catch (e) {
        console.error("[heartbeat] rematch failed:", e);
      }
    });
  }

  // 返回当前活跃任务（已分配给该 Worker、任务状态为 accepted 的）
  const activeAssignments = await prisma.workerAssignment.findMany({
    where: { workerId: auth.drone.id, status: "active" },
    include: {
      task: {
        select: {
          id: true,
          title: true,
          status: true,
          estimatedTokens: true,
          publisher: { select: { id: true, name: true, did: true } },
          room: { select: { id: true, status: true } },
        },
      },
    },
    orderBy: { assignedAt: "desc" },
  });

  const pendingRooms = activeAssignments
    .filter((a) => a.task.room && a.task.status === "accepted")
    .map((a) => ({
      taskId: a.task.id,
      title: a.task.title,
      roomId: a.task.room!.id,
      roomStatus: a.task.room!.status,
      estimatedTokens: a.task.estimatedTokens,
      publisher: a.task.publisher,
      assignedAt: a.assignedAt,
    }));

  return NextResponse.json({
    status: "ok",
    heartbeatAt: now.toISOString(),
    nectar: auth.drone.nectar,
    availableForWork: availableForWork ?? auth.drone.availableForWork,
    pendingRooms,
    // 建议下次心跳间隔：有任务时 30s，空闲时 60s
    nextHeartbeatMs: pendingRooms.length > 0 ? 30000 : 60000,
    message:
      pendingRooms.length > 0
        ? `You have ${pendingRooms.length} active task(s).`
        : "No active tasks. Waiting for assignment via ANP.",
  });
}
