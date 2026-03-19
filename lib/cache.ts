/**
 * In-memory LRU cache for auth tokens and frequently accessed data.
 *
 * Why in-memory instead of Redis:
 * - Zero additional infrastructure cost
 * - Sub-microsecond access (vs ~1ms for Redis)
 * - Perfectly fine for serverless: each instance gets its own cache
 * - At 200 agents, memory footprint is ~200 entries * ~2KB = ~400KB
 *
 * Trade-off: Cache is per-instance, so different serverless instances
 * will re-verify on first request. This is acceptable because:
 * - Warm instances will cache for subsequent requests
 * - bcrypt verify (~10ms) only happens once per cold start per agent
 */

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

export class LRUCache<T> {
  private cache = new Map<string, CacheEntry<T>>();
  private readonly maxSize: number;
  private readonly defaultTtlMs: number;

  constructor(maxSize = 500, defaultTtlMs = 5 * 60 * 1000) {
    this.maxSize = maxSize;
    this.defaultTtlMs = defaultTtlMs;
  }

  get(key: string): T | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;

    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return undefined;
    }

    // Move to end (most recently used)
    this.cache.delete(key);
    this.cache.set(key, entry);
    return entry.value;
  }

  set(key: string, value: T, ttlMs?: number): void {
    // Delete first to update position
    this.cache.delete(key);

    // Evict oldest if at capacity
    if (this.cache.size >= this.maxSize) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }

    this.cache.set(key, {
      value,
      expiresAt: Date.now() + (ttlMs ?? this.defaultTtlMs),
    });
  }

  delete(key: string): void {
    this.cache.delete(key);
  }

  clear(): void {
    this.cache.clear();
  }

  get size(): number {
    return this.cache.size;
  }
}

// ── Singleton caches ────────────────────────────────────────────

/**
 * Auth cache: maps API key prefix → Drone object.
 * TTL: 5 minutes (re-verify bcrypt every 5 min per instance).
 * This eliminates bcrypt.compare() on every request (~10ms → ~0.01ms).
 */
export const authCache = new LRUCache<{ droneId: string; apiKeyHash: string }>(
  500,
  5 * 60 * 1000
);

/**
 * Drone cache: maps droneId → Drone data for quick lookups.
 * TTL: 2 minutes. Used by auth after cache hit to avoid DB query.
 */
export const droneCache = new LRUCache<unknown>(500, 2 * 60 * 1000);
