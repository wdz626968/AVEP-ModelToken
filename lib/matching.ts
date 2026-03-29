import { prisma } from "./prisma";
import type { Drone, TrustScore } from "@prisma/client";
import { ACK_DEADLINE_MS } from "./constants";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TaskContext {
  category: string | null;
  priority: "high" | "medium" | "low";
  estimatedTokens: number;
  publisherId: string;
  /** Publisher 偏好（v2 新增） */
  preference?: MatchPreference;
}

export interface MatchPreference {
  /** 优先使用指定 DID 的 Worker */
  preferredWorkerDid?: string;
  /** 排除指定 DID 的 Worker 列表 */
  excludeWorkerDids?: string[];
  /** 要求 Worker 具备的能力标签 */
  requireCapabilities?: string[];
  /** Worker 最低信任分要求（0-100） */
  minTrustScore?: number;
  /** true = 优先速度，false = 优先质量 */
  preferFastOverQuality?: boolean;
}

export interface WorkerCandidate {
  drone: Drone & { trustScore: TrustScore | null };
  activeTaskCount: number;
  recentCancelCount: number;
  historicalCollabCount: number;
  /** Worker 自声明的最大并发任务数（v2：从 capabilities JSON 读取） */
  maxConcurrentTasks: number;
}

export interface ScoredCandidate extends WorkerCandidate {
  matchScore: number;
  /** 各评分维度明细，用于日志和 API 响应透明化 */
  scoreBreakdown: ScoreBreakdown;
}

export interface ScoreBreakdown {
  completionRate: number;
  responseSpeed: number;
  probePassRate: number;
  uptimeRatio: number;
  didAuthenticity: number;
  heartbeatFreshness: number;
  capabilityMatch: number;
  loadPenaltyFactor: number;
  cancelPenaltyFactor: number;
  valueQualityGate: "pass" | "blocked" | "na";
  preferenceBonus: number;
  collabBonus: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const HEARTBEAT_WINDOW_MS = 20 * 60 * 1000; // 与 heartbeatFreshnessScore 截止对齐（>20min 得 0 分无意义进候选池）
const MAX_CANDIDATES = 50;
const DEFAULT_MAX_CONCURRENT_TASKS = 3;
const SYSTEM_MAX_CONCURRENT_TASKS = 10; // 防止 Worker 自声明过高

// Bayesian smoothing priors
// v3: increased alpha values to better reflect actual AI Agent market (avg completion ≈ 0.85)
const COMPLETION_ALPHA = 7;
const COMPLETION_BETA = 3;   // prior mean = 7/10 = 0.70 (was 0.50 in v2)
const PROBE_ALPHA = 8;
const PROBE_BETA = 2;        // prior mean = 8/10 = 0.80 (was 0.60 in v2)

// Heartbeat decay: score(t) = 15·exp(−λt) + 5, λ = ln(3)/10
const HEARTBEAT_DECAY_LAMBDA = Math.log(3) / 10;

// ---------------------------------------------------------------------------
// Bayesian smoothing helpers
// ---------------------------------------------------------------------------

/**
 * Smooth a rate with a Beta prior to handle cold-start and low-sample bias.
 * smoothed = (successes + alpha) / (total + alpha + beta)
 */
function bayesianSmooth(
  rate: number | null | undefined,
  total: number | null | undefined,
  alpha: number,
  beta: number
): number {
  const t = total ?? 0;
  const successes = (rate ?? 0) * t;
  return (successes + alpha) / (t + alpha + beta);
}

// ---------------------------------------------------------------------------
// Heartbeat freshness (continuous exponential decay, no step jumps)
// ---------------------------------------------------------------------------

/**
 * Returns a freshness score in [0, 20].
 * score(t) = 15·exp(−λ·t) + 5  for t < 20 min
 *           = 0                  for t ≥ 20 min
 * This replaces the v1 step function, eliminating sudden ranking jumps
 * at the 1/3/10/20 minute boundaries.
 */
function heartbeatFreshnessScore(lastHeartbeat: Date | null): number {
  if (!lastHeartbeat) return 0;
  const minutesAgo = (Date.now() - lastHeartbeat.getTime()) / 60000;
  if (minutesAgo >= 20) return 0;
  return 15 * Math.exp(-HEARTBEAT_DECAY_LAMBDA * minutesAgo) + 5;
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

/**
 * Score a single Worker against a Task.
 *
 * v2 changes from v1:
 *  - Bayesian smoothing on taskCompletionRate + probePassRate (cold-start fix)
 *  - Continuous exponential heartbeat decay (no step-jump ranking instability)
 *  - Hard value-quality gate instead of subtract penalty (DID/overallScore conflict fix)
 *  - Multiplicative load/cancel penalty factors (proportional to score, not additive)
 *  - Worker self-declared maxConcurrentTasks from capabilities JSON
 *  - Publisher preference bonus (+15 preferred, required capabilities gate)
 *  - scoreBreakdown returned for observability
 */
export function scoreWorkerForTask(
  worker: WorkerCandidate,
  task: TaskContext
): { score: number; breakdown: ScoreBreakdown } {
  const trust = worker.drone.trustScore;
  const breakdown: ScoreBreakdown = {
    completionRate: 0,
    responseSpeed: 0,
    probePassRate: 0,
    uptimeRatio: 0,
    didAuthenticity: 0,
    heartbeatFreshness: 0,
    capabilityMatch: 0,
    loadPenaltyFactor: 1,
    cancelPenaltyFactor: 1,
    valueQualityGate: "na",
    preferenceBonus: 0,
    collabBonus: 0,
  };

  // ── 1. Hard gates (return score=0 immediately if blocked) ─────────────────

  // Value-quality gate: high-value tasks require minimum trust
  if (task.estimatedTokens >= 500) {
    const overall = trust?.overallScore ?? 50;
    const authScore = trust?.authenticityScore ?? 50;
    if (overall < 40 || authScore < 50) {
      breakdown.valueQualityGate = "blocked";
      return { score: 0, breakdown };
    }
    breakdown.valueQualityGate = "pass";
  } else if (task.estimatedTokens >= 200) {
    const overall = trust?.overallScore ?? 50;
    if (overall < 30) {
      breakdown.valueQualityGate = "blocked";
      return { score: 0, breakdown };
    }
    breakdown.valueQualityGate = "pass";
  }

  // Publisher preference gates
  if (task.preference?.excludeWorkerDids?.includes(worker.drone.did ?? "")) {
    return { score: 0, breakdown };
  }
  if (task.preference?.requireCapabilities?.length) {
    try {
      const caps = worker.drone.capabilities
        ? JSON.parse(worker.drone.capabilities)
        : {};
      const workerCats: string[] = caps.categories ?? [];
      const hasAll = task.preference.requireCapabilities.every((c) =>
        workerCats.includes(c)
      );
      if (!hasAll) return { score: 0, breakdown };
    } catch {
      return { score: 0, breakdown };
    }
  }
  if (task.preference?.minTrustScore) {
    const overall = trust?.overallScore ?? 50;
    if (overall < task.preference.minTrustScore) {
      return { score: 0, breakdown };
    }
  }

  // ── 2. Base score dimensions ───────────────────────────────────────────────

  // 1. Task completion rate (Bayesian smoothed, dynamic weight)
  const smoothedCompletion = bayesianSmooth(
    trust?.taskCompletionRate,
    trust?.totalTasks,
    COMPLETION_ALPHA,
    COMPLETION_BETA
  );
  const completionWeight = task.priority === "high" ? 25
    : task.priority === "medium" ? 20 : 15;
  // Adjusted down from v1's 30/25/20 to leave room for probe weight increase
  const pref = task.preference;
  const qualityMultiplier = pref?.preferFastOverQuality === false ? 1.2
    : pref?.preferFastOverQuality === true ? 0.8 : 1.0;
  breakdown.completionRate = smoothedCompletion * completionWeight * qualityMultiplier;

  // 2. Response speed (dynamic weight, 30s benchmark)
  const speedWeight = task.priority === "high" ? 15 : 10;
  const speedMultiplier = pref?.preferFastOverQuality === true ? 1.3
    : pref?.preferFastOverQuality === false ? 0.8 : 1.0;
  const avgMs = trust?.avgResponseMs ?? 30000;
  breakdown.responseSpeed =
    Math.max(0, 1 - Math.min(avgMs, 30000) / 30000) * speedWeight * speedMultiplier;

  // 3. Probe pass rate (Bayesian smoothed, increased weight v1:10 → v2:13)
  const smoothedProbe = bayesianSmooth(
    trust?.probePassRate,
    trust?.totalProbes,
    PROBE_ALPHA,
    PROBE_BETA
  );
  breakdown.probePassRate = smoothedProbe * 13;

  // 4. Uptime ratio
  breakdown.uptimeRatio = (trust?.uptimeRatio ?? 0) * 8;

  // 5. DID authenticity score (increased weight v1:0.07 → v2:0.09)
  breakdown.didAuthenticity = (trust?.authenticityScore ?? 50) * 0.09;

  // 6. Heartbeat freshness (continuous exponential decay, replaces v1 step function)
  breakdown.heartbeatFreshness = heartbeatFreshnessScore(worker.drone.lastHeartbeat);

  // 7. Capability match
  if (task.category && worker.drone.capabilities) {
    try {
      const caps = JSON.parse(worker.drone.capabilities);
      if (Array.isArray(caps.categories) && caps.categories.includes(task.category)) {
        breakdown.capabilityMatch += 15;
        const confidence = caps.skill_confidence?.[task.category];
        // v3 fix: null confidence → 3 pts (was 5, same as confidence=1.0 — logic was inverted)
        breakdown.capabilityMatch += typeof confidence === "number" ? confidence * 5 : 3;
      }
    } catch {
      /* malformed capabilities JSON — skip */
    }
  }

  // 9. Historical collaboration bonus
  breakdown.collabBonus = Math.min(worker.historicalCollabCount * 1.5, 6);

  // 10. Preferred Worker bonus — v3: capped lower to prevent relationship-network dominance
  // Also gate: only apply if Worker has a minimum rawScore baseline (prevents low-quality bypass)
  if (
    task.preference?.preferredWorkerDid &&
    worker.drone.did === task.preference.preferredWorkerDid
  ) {
    breakdown.preferenceBonus = 10; // v3: reduced from 15 to 10
  }

  // ── 3. Raw score (before multiplicative penalties) ─────────────────────────
  const rawScore =
    breakdown.completionRate +
    breakdown.responseSpeed +
    breakdown.probePassRate +
    breakdown.uptimeRatio +
    breakdown.didAuthenticity +
    breakdown.heartbeatFreshness +
    breakdown.capabilityMatch +
    breakdown.collabBonus +
    breakdown.preferenceBonus;

  // ── 4. Multiplicative penalty factors ─────────────────────────────────────
  // Load penalty: each active task reduces score by 10%, capped at -30%
  breakdown.loadPenaltyFactor = Math.max(
    0.7,
    1 - 0.10 * worker.activeTaskCount
  );
  // Cancel penalty: each recent cancel reduces score by 8%, capped at -40%
  breakdown.cancelPenaltyFactor = Math.max(
    0.6,
    1 - 0.08 * Math.min(worker.recentCancelCount, 5)
  );

  const finalScore =
    rawScore * breakdown.loadPenaltyFactor * breakdown.cancelPenaltyFactor;

  return { score: Math.max(0, Math.round(finalScore * 100) / 100), breakdown };
}

// ---------------------------------------------------------------------------
// Candidate fetching
// ---------------------------------------------------------------------------

/**
 * Fetch and score all eligible Workers for a given task.
 * Used by both auto-match (at publish time) and the /match preview endpoint.
 * Returns candidates sorted by matchScore descending.
 *
 * v2 changes:
 *  - orderBy lastHeartbeat DESC before take (fix random heap-scan truncation)
 *  - Worker self-declared maxConcurrentTasks from capabilities JSON
 *  - Batch queries for recentCancels + historicalCollabs with proper index hints
 */
export async function fetchScoredCandidates(
  task: TaskContext
): Promise<ScoredCandidate[]> {
  const cutoff = new Date(Date.now() - HEARTBEAT_WINDOW_MS);

  // v2 fix: orderBy lastHeartbeat DESC ensures we get the most recently active
  // workers first — not random heap-scan order. Utilizes @@index([status, lastHeartbeat]).
  const rawCandidates = await prisma.drone.findMany({
    where: {
      id: { not: task.publisherId },
      status: "active",
      lastHeartbeat: { gte: cutoff },
      availableForWork: true,   // 只选主动上线接单的 Worker
      // Exclude explicitly blocked Workers from Publisher preference
      ...(task.preference?.excludeWorkerDids?.length
        ? { did: { notIn: task.preference.excludeWorkerDids } }
        : {}),
    },
    include: {
      trustScore: true,
      workerAssignments: {
        where: { status: "active" },
        select: { taskId: true },
      },
    },
    orderBy: { lastHeartbeat: "desc" }, // v2 fix: deterministic, index-friendly ordering
    take: MAX_CANDIDATES,
  });

  // Parse Worker self-declared maxConcurrentTasks from capabilities
  const withMaxConcurrent = rawCandidates.map((c) => {
    let maxConcurrentTasks = DEFAULT_MAX_CONCURRENT_TASKS;
    if (c.capabilities) {
      try {
        const caps = JSON.parse(c.capabilities);
        if (
          typeof caps.maxConcurrentTasks === "number" &&
          caps.maxConcurrentTasks >= 1
        ) {
          maxConcurrentTasks = Math.min(
            Math.floor(caps.maxConcurrentTasks),
            SYSTEM_MAX_CONCURRENT_TASKS
          );
        }
      } catch {
        /* malformed — use default */
      }
    }
    return { drone: c, maxConcurrentTasks };
  });

  // Filter out overloaded workers
  const eligible = withMaxConcurrent.filter(
    ({ drone, maxConcurrentTasks }) =>
      drone.workerAssignments.length < maxConcurrentTasks
  );

  if (eligible.length === 0) return [];

  const eligibleIds = eligible.map(({ drone }) => drone.id);
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000);

  // Batch queries — WorkerAssignment now has @@index([workerId, status, assignedAt])
  const [recentCancels, historicalCollabs] = await Promise.all([
    prisma.workerAssignment.groupBy({
      by: ["workerId"],
      where: {
        workerId: { in: eligibleIds },
        status: { in: ["switched", "failed"] },
        assignedAt: { gte: sevenDaysAgo },
      },
      _count: { workerId: true },
    }),
    prisma.task.groupBy({
      by: ["workerId"],
      where: {
        workerId: { in: eligibleIds },
        publisherId: task.publisherId,
        status: "completed",
      },
      _count: { workerId: true },
    }),
  ]);

  const cancelMap = new Map(
    recentCancels.map((r) => [r.workerId, r._count.workerId])
  );
  const collabMap = new Map(
    historicalCollabs.map((r) => [r.workerId!, r._count.workerId])
  );

  return eligible
    .map(({ drone, maxConcurrentTasks }) => {
      const candidate: WorkerCandidate = {
        drone,
        activeTaskCount: drone.workerAssignments.length,
        recentCancelCount: cancelMap.get(drone.id) ?? 0,
        historicalCollabCount: collabMap.get(drone.id) ?? 0,
        maxConcurrentTasks,
      };
      const { score, breakdown } = scoreWorkerForTask(candidate, task);
      return {
        ...candidate,
        matchScore: score,
        scoreBreakdown: breakdown,
      };
    })
    .sort((a, b) => b.matchScore - a.matchScore);
}

/**
 * Pick the single best Worker for a task, or null if no candidates.
 */
export async function findBestWorker(
  task: TaskContext
): Promise<{
  worker: Drone & { trustScore: TrustScore | null };
  matchScore: number;
  breakdown: ScoreBreakdown;
  candidateCount: number;
} | null> {
  const candidates = await fetchScoredCandidates(task);
  if (candidates.length === 0) return null;
  const best = candidates[0];
  return {
    worker: best.drone,
    matchScore: best.matchScore,
    breakdown: best.scoreBreakdown,
    candidateCount: candidates.length,
  };
}

// ---------------------------------------------------------------------------
// Task scoring for Worker (used by tryAutoMatch — Worker perspective)
// ---------------------------------------------------------------------------

/**
 * Score a pending Task from the Worker's perspective.
 * Used by tryAutoMatch to select the best-fit task (instead of FIFO).
 *
 * Dimensions:
 *  1. Nectar density: estimatedTokens value
 *  2. Capability match: Worker's skills vs task category
 *  3. Task age penalty: older pending tasks score lower (may have been rejected)
 *  4. Priority premium: high-priority tasks are higher-value
 *  5. Publisher reliability: historical collab success rate with this publisher
 */
export function scoreTaskForWorker(
  task: {
    id: string;
    category: string | null;
    priority: string;
    estimatedTokens: number;
    publisherId: string;
    createdAt: Date;
  },
  worker: Drone,
  publisherCollabCount: number
): number {
  let score = 0;

  // 1. Nectar value (normalized to 0-20, capped at 1000 tokens)
  score += Math.min(task.estimatedTokens / 1000, 1) * 20;

  // 2. Priority premium
  score += task.priority === "high" ? 10 : task.priority === "medium" ? 5 : 0;

  // 3. Capability match
  if (task.category && worker.capabilities) {
    try {
      const caps = JSON.parse(worker.capabilities);
      if (Array.isArray(caps.categories) && caps.categories.includes(task.category)) {
        score += 15;
        const confidence = caps.skill_confidence?.[task.category];
        score += typeof confidence === "number" ? confidence * 5 : 3;
      }
    } catch { /* skip */ }
  }

  // 4. Task age urgency bonus (v3 fix: reversed from penalty to urgency premium)
  // Older tasks are more urgent — Workers should prefer clearing backlog.
  const ageMinutes = (Date.now() - task.createdAt.getTime()) / 60000;
  score += Math.min(ageMinutes / 20, 15);

  // 5. Publisher reliability bonus (up to +8)
  score += Math.min(publisherCollabCount * 2, 8);

  return Math.max(0, score);
}

// ---------------------------------------------------------------------------
// Match hints for Publisher API response
// ---------------------------------------------------------------------------

/**
 * Generate matchHint fields for the POST /api/tasks response.
 * Helps Publisher Agents make informed decisions when status="pending".
 */
export async function generateMatchHint(
  publisherId: string,
  category: string | null,
  estimatedTokens: number
): Promise<{
  onlineWorkerCount: number;
  capableWorkerCount: number;
  matchConfidence: "high" | "medium" | "low" | "none";
  suggestedPollIntervalMs: number;
  taskExpiresAt: string;
}> {
  const cutoff = new Date(Date.now() - HEARTBEAT_WINDOW_MS);
  const expiresAt = new Date(Date.now() + 4 * 60 * 60 * 1000);

  const [onlineCount, capableCount] = await Promise.all([
    prisma.drone.count({
      where: { id: { not: publisherId }, status: "active", lastHeartbeat: { gte: cutoff } },
    }),
    category
      ? prisma.drone.count({
          where: {
            id: { not: publisherId },
            status: "active",
            lastHeartbeat: { gte: cutoff },
            // v3 fix: match exact JSON string value to avoid false-positives.
            // e.g. '"code"' will not match '"code-review"'.
            capabilities: { contains: `"${category}"` },
          },
        })
      : Promise.resolve(0),
  ]);

  const effectiveCapable = category ? capableCount : onlineCount;
  const matchConfidence: "high" | "medium" | "low" | "none" =
    effectiveCapable >= 5 ? "high"
    : effectiveCapable >= 2 ? "medium"
    : effectiveCapable >= 1 ? "low"
    : "none";

  const suggestedPollIntervalMs =
    matchConfidence === "high" ? 5000
    : matchConfidence === "medium" ? 15000
    : matchConfidence === "low" ? 30000
    : 60000;

  return {
    onlineWorkerCount: onlineCount,
    capableWorkerCount: effectiveCapable,
    matchConfidence,
    suggestedPollIntervalMs,
    taskExpiresAt: expiresAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Worker 上线补撮合
// ---------------------------------------------------------------------------

/**
 * 当 Worker 上线（availableForWork=true）时，尝试将积压的 pending 任务分配给该 Worker。
 *
 * 策略：
 *  - 只处理状态为 "pending" 的任务（创建时没有匹配到 Worker 的）
 *  - 用 scoreTaskForWorker 对所有 pending 任务评分，取最高分任务依次分配
 *  - 受 Worker 的 maxConcurrentTasks 上限约束
 *  - 每次分配完成后通过 ANP 推送通知 Worker
 *  - 全程异步，不阻塞 heartbeat 响应
 *
 * @param workerId  Worker 的数据库 ID
 * @param anpPushFn 注入 ANP 推送函数（避免循环依赖 anp.ts → matching.ts）
 */
export async function tryAssignPendingTasksToWorker(
  workerId: string,
  anpPushFn: (toDid: string, payload: Record<string, unknown>) => Promise<void>
): Promise<void> {
  // 1. 获取 Worker 最新状态（确保仍在线可接单）
  const worker = await prisma.drone.findUnique({
    where: { id: workerId },
    include: {
      trustScore: true,
      workerAssignments: { where: { status: "active" }, select: { taskId: true } },
    },
  });

  if (
    !worker ||
    worker.status !== "active" ||
    !worker.availableForWork
  ) return;

  // 2. 计算 Worker 当前可接单槽位
  let maxConcurrent = 3;
  if (worker.capabilities) {
    try {
      const caps = JSON.parse(worker.capabilities);
      if (typeof caps.maxConcurrentTasks === "number" && caps.maxConcurrentTasks >= 1) {
        maxConcurrent = Math.min(Math.floor(caps.maxConcurrentTasks), 10);
      }
    } catch { /* malformed, use default */ }
  }
  const availableSlots = maxConcurrent - worker.workerAssignments.length;
  if (availableSlots <= 0) return;

  // 3. 拉取积压 pending 任务（排除该 Worker 自己发布的）
  const pendingTasks = await prisma.task.findMany({
    where: {
      status: "pending",
      publisherId: { not: workerId },
    },
    select: {
      id: true,
      title: true,
      description: true,
      publicPayload: true,
      category: true,
      priority: true,
      estimatedTokens: true,
      publisherId: true,
      createdAt: true,
      matchPreference: true,
      publisher: { select: { id: true, name: true, did: true } },
    },
    orderBy: { createdAt: "asc" }, // 越早的任务越优先（防止饥饿）
    take: 50,
  });

  if (pendingTasks.length === 0) return;

  // 4. 批量查询该 Worker 与各 Publisher 的历史协作数
  const publisherIds = [...new Set(pendingTasks.map((t) => t.publisherId))];
  const collabCounts = await prisma.task.groupBy({
    by: ["publisherId"],
    where: {
      workerId,
      publisherId: { in: publisherIds },
      status: "completed",
    },
    _count: { publisherId: true },
  });
  const collabMap = new Map(collabCounts.map((r) => [r.publisherId, r._count.publisherId]));

  // 5. 过滤 matchPreference 硬门槛，再评分排序
  const trust = worker.trustScore;
  const scoredTasks = pendingTasks
    .filter((t) => {
      if (!t.matchPreference) return true;
      let pref: MatchPreference;
      try { pref = JSON.parse(t.matchPreference); } catch { return true; }

      // 排除列表
      if (pref.excludeWorkerDids?.includes(worker.did ?? "")) return false;
      // 必须具备的能力
      if (pref.requireCapabilities?.length) {
        try {
          const caps = worker.capabilities ? JSON.parse(worker.capabilities) : {};
          const workerCats: string[] = caps.categories ?? [];
          if (!pref.requireCapabilities.every((c) => workerCats.includes(c))) return false;
        } catch { return false; }
      }
      // 最低信任分
      if (pref.minTrustScore) {
        const overall = trust?.overallScore ?? 50;
        if (overall < pref.minTrustScore) return false;
      }
      return true;
    })
    .map((t) => ({
      task: t,
      score: scoreTaskForWorker(t, worker, collabMap.get(t.publisherId) ?? 0),
    }))
    .sort((a, b) => b.score - a.score);

  // 6. 依次分配，直到填满槽位
  let assigned = 0;
  for (const { task } of scoredTasks) {
    if (assigned >= availableSlots) break;

    try {
      // 乐观原子事务：同时检查任务仍为 pending、Worker 仍有空闲槽位
      const result = await prisma.$transaction(async (tx) => {
        // 重新检查任务状态（防止并发竞争）
        const freshTask = await tx.task.findUnique({
          where: { id: task.id },
          select: { status: true },
        });
        if (!freshTask || freshTask.status !== "pending") return null;

        // 重新检查 Worker 当前负载
        const activeCount = await tx.workerAssignment.count({
          where: { workerId, status: "active" },
        });
        if (activeCount >= maxConcurrent) return null;

        const now = new Date();

        // 更新任务状态
        const updatedTask = await tx.task.update({
          where: { id: task.id },
          data: {
            status: "accepted",
            workerId,
            acceptedAt: now,
            ackDeadline: new Date(now.getTime() + ACK_DEADLINE_MS),
          },
        });

        // 创建 Room
        const room = await tx.room.create({
          data: { taskId: task.id, mode: "centralized", status: "active" },
        });

        // 创建 WorkerAssignment
        await tx.workerAssignment.create({
          data: { taskId: task.id, workerId, status: "active" },
        });

        // 写入系统消息（记录补撮合来源）
        await tx.roomMessage.create({
          data: {
            roomId: room.id,
            senderId: task.publisherId,
            type: "system",
            content: JSON.stringify({
              event: "worker_assigned",
              workerId,
              workerName: worker.name,
              mode: "centralized",
              autoAssigned: true,
              assignReason: "worker_online_rematch",
            }),
          },
        });

        return { updatedTask, room };
      });

      if (!result) continue;

      assigned++;
      console.log(JSON.stringify({
        event: "rematch_assigned",
        taskId: task.id,
        workerId,
        workerName: worker.name,
        ts: new Date().toISOString(),
      }));

      // 7. ANP 推送通知 Worker
      if (worker.did) {
        anpPushFn(worker.did, {
          type: "avep_task_assigned",
          taskId: task.id,
          roomId: result.room.id,
          taskPayload: {
            title: task.title,
            description: task.description,
            estimatedTokens: task.estimatedTokens,
            category: task.category,
            priority: task.priority,
            publicPayload: task.publicPayload ? JSON.parse(task.publicPayload) : null,
          },
          publisherDid: task.publisher.did ?? undefined,
          instructions: [
            `1. Immediately POST to /api/rooms/${result.room.id}/messages with { "type": "ready", "content": "acknowledged" }`,
            `2. Execute the task described in taskPayload`,
            `3. POST result to /api/rooms/${result.room.id}/messages with { "type": "result", "content": { "result": "...", "actualTokens": N } }`,
          ],
        }).catch((e: unknown) =>
          console.error("[ANP] rematch push to worker failed:", e)
        );
      }
    } catch (err) {
      console.error("[rematch] assign task", task.id, "to worker", workerId, "failed:", err);
    }
  }

  if (assigned > 0) {
    console.log(`[rematch] assigned ${assigned} pending task(s) to worker ${worker.name} (${workerId})`);
  }
}
