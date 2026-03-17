/**
 * In-memory sliding-window rate limiter.
 *
 * Designed for 200 concurrent agents:
 * - Per-agent: 30 requests/minute (heartbeat + messages + checkpoints)
 * - Global: 2000 requests/minute across all agents
 * - Memory: ~200 agents * ~100 bytes = ~20KB
 *
 * Uses sliding window for accurate rate counting without storing individual timestamps.
 */

interface RateWindow {
  count: number;
  windowStart: number;
}

const windowMs = 60_000; // 1 minute window
const perAgentLimit = 30; // 30 req/min per agent
const globalLimit = 2000; // 2000 req/min total

const agentWindows = new Map<string, RateWindow>();
let globalWindow: RateWindow = { count: 0, windowStart: Date.now() };

function getOrCreateWindow(
  map: Map<string, RateWindow>,
  key: string
): RateWindow {
  const now = Date.now();
  let w = map.get(key);
  if (!w || now - w.windowStart >= windowMs) {
    w = { count: 0, windowStart: now };
    map.set(key, w);
  }
  return w;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterMs?: number;
}

/**
 * Check rate limit for an agent.
 * Returns { allowed, remaining, retryAfterMs }.
 */
export function checkRateLimit(agentId: string): RateLimitResult {
  const now = Date.now();

  // Reset global window if expired
  if (now - globalWindow.windowStart >= windowMs) {
    globalWindow = { count: 0, windowStart: now };
  }

  // Check global limit
  if (globalWindow.count >= globalLimit) {
    return {
      allowed: false,
      remaining: 0,
      retryAfterMs: windowMs - (now - globalWindow.windowStart),
    };
  }

  // Check per-agent limit
  const agentWindow = getOrCreateWindow(agentWindows, agentId);
  if (agentWindow.count >= perAgentLimit) {
    return {
      allowed: false,
      remaining: 0,
      retryAfterMs: windowMs - (now - agentWindow.windowStart),
    };
  }

  // Allow and increment
  agentWindow.count++;
  globalWindow.count++;

  return {
    allowed: true,
    remaining: perAgentLimit - agentWindow.count,
  };
}

/**
 * Cleanup stale windows (call periodically).
 */
export function cleanupRateLimits(): void {
  const now = Date.now();
  agentWindows.forEach((w, key) => {
    if (now - w.windowStart >= windowMs * 2) {
      agentWindows.delete(key);
    }
  });
}

// Auto-cleanup every 5 minutes
if (typeof setInterval !== "undefined") {
  setInterval(cleanupRateLimits, 5 * 60_000);
}
