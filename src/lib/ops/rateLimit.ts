export type RateLimitResult = {
  allowed: boolean;
  retryAfterSeconds: number;
};

type RateLimitEntry = {
  count: number;
  resetAt: number;
};

const MAX_ENTRIES = 5000;

const buckets = new Map<string, RateLimitEntry>();

function pruneExpired(now: number): void {
  for (const [key, entry] of buckets) {
    if (entry.resetAt <= now) {
      buckets.delete(key);
    }
  }
}

function evictOldestIfNeeded(): void {
  if (buckets.size < MAX_ENTRIES) {
    return;
  }
  let oldestKey: string | undefined;
  let oldestResetAt = Infinity;
  for (const [key, entry] of buckets) {
    if (entry.resetAt < oldestResetAt) {
      oldestResetAt = entry.resetAt;
      oldestKey = key;
    }
  }
  if (oldestKey !== undefined) {
    buckets.delete(oldestKey);
  }
}

export function checkRateLimit(
  key: string,
  opts: { limit: number; windowMs: number; now?: number },
): RateLimitResult {
  const now = opts.now ?? Date.now();
  pruneExpired(now);

  const existing = buckets.get(key);
  if (!existing || existing.resetAt <= now) {
    evictOldestIfNeeded();
    buckets.set(key, { count: 1, resetAt: now + opts.windowMs });
    return { allowed: true, retryAfterSeconds: 0 };
  }

  if (existing.count < opts.limit) {
    existing.count += 1;
    return { allowed: true, retryAfterSeconds: 0 };
  }

  return {
    allowed: false,
    retryAfterSeconds: Math.ceil((existing.resetAt - now) / 1000),
  };
}

export function resetRateLimits(): void {
  buckets.clear();
}

export function clientKey(req: Request, suffix: string): string {
  const forwardedFor = req.headers.get('x-forwarded-for');
  let peer: string | null = null;
  if (forwardedFor) {
    const first = forwardedFor.split(',')[0]?.trim();
    if (first) {
      peer = first;
    }
  }
  if (!peer) {
    const realIp = req.headers.get('x-real-ip');
    if (realIp && realIp.trim()) {
      peer = realIp.trim();
    }
  }
  if (!peer) {
    peer = 'local';
  }
  return `${peer}:${suffix}`;
}
