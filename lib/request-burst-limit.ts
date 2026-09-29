type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();
let callsSinceSweep = 0;

function clientAddress(request: Request) {
  const forwarded = request.headers.get("x-vercel-forwarded-for")
    ?? request.headers.get("cf-connecting-ip")
    ?? request.headers.get("x-real-ip")
    ?? request.headers.get("x-forwarded-for");
  return forwarded?.split(",")[0]?.trim() || "unknown";
}

function sweepExpired(now: number) {
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

export type BurstLimitResult = {
  allowed: boolean;
  retryAfterSeconds: number;
};

export function consumeRequestBurst(
  request: Request,
  namespace: string,
  limit: number,
  windowMs: number,
): BurstLimitResult {
  const now = Date.now();
  callsSinceSweep += 1;
  if (callsSinceSweep >= 128) {
    callsSinceSweep = 0;
    sweepExpired(now);
  }

  const key = `${namespace}:${clientAddress(request)}`;
  const existing = buckets.get(key);

  if (!existing || existing.resetAt <= now) {
    if (!existing && buckets.size >= 4096) {
      const oldestKey = buckets.keys().next().value as string | undefined;
      if (oldestKey) buckets.delete(oldestKey);
    }
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, retryAfterSeconds: 0 };
  }

  if (existing.count >= limit) {
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
    };
  }

  existing.count += 1;
  return { allowed: true, retryAfterSeconds: 0 };
}
