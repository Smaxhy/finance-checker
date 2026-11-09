/**
 * Minimal sliding-window rate limiter kept in process memory.
 * Good enough for a single-user / single-instance deployment; on multiple
 * serverless instances each instance keeps its own window (best effort).
 */
export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;
}

export function createRateLimiter(limit: number, windowMs: number) {
  const hits = new Map<string, number[]>();
  return {
    check(key: string, now = Date.now()): RateLimitResult {
      const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
      if (recent.length >= limit) {
        hits.set(key, recent);
        return { allowed: false, remaining: 0, retryAfterMs: windowMs - (now - recent[0]) };
      }
      recent.push(now);
      hits.set(key, recent);
      return { allowed: true, remaining: limit - recent.length, retryAfterMs: 0 };
    },
    reset(key?: string) {
      if (key) hits.delete(key);
      else hits.clear();
    },
  };
}

/** Shared limiter for the assistant endpoint: 20 questions per 10 minutes per user. */
export const assistantRateLimit = createRateLimiter(20, 10 * 60_000);
