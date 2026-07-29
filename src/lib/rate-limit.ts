import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

/**
 * Rate limiting exists on the verification endpoints only. The claim endpoint
 * is deliberately left out of the Redis path: it must do zero external calls
 * at drop time, and it is already protected by requiring a pre-issued
 * verification cookie plus the one-signup-per-member index.
 *
 * Falls back to an in-process limiter when Upstash is not configured. That is
 * fine for local development but does not hold across serverless instances -
 * configure Upstash before a real drop.
 */

export interface LimitResult {
  success: boolean;
  remaining: number;
}

const url = process.env.UPSTASH_REDIS_REST_URL;
const token = process.env.UPSTASH_REDIS_REST_TOKEN;
const redis = url && token ? new Redis({ url, token }) : null;

export const usingDistributedLimiter = redis !== null;

const limiters = new Map<string, Ratelimit>();
const memory = new Map<string, number[]>();

function getLimiter(name: string, max: number, windowSeconds: number): Ratelimit | null {
  if (!redis) return null;
  const key = `${name}:${max}:${windowSeconds}`;
  let limiter = limiters.get(key);
  if (!limiter) {
    limiter = new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(max, `${windowSeconds} s`),
      prefix: `cusnow:${name}`,
      analytics: false,
    });
    limiters.set(key, limiter);
  }
  return limiter;
}

function memoryLimit(key: string, max: number, windowSeconds: number): LimitResult {
  const now = Date.now();
  const cutoff = now - windowSeconds * 1000;
  const hits = (memory.get(key) ?? []).filter((t) => t > cutoff);

  if (hits.length >= max) {
    memory.set(key, hits);
    return { success: false, remaining: 0 };
  }

  hits.push(now);
  memory.set(key, hits);
  return { success: true, remaining: max - hits.length };
}

export async function rateLimit(
  name: string,
  identifier: string,
  max: number,
  windowSeconds: number,
): Promise<LimitResult> {
  const limiter = getLimiter(name, max, windowSeconds);
  if (!limiter) return memoryLimit(`${name}:${identifier}`, max, windowSeconds);

  const { success, remaining } = await limiter.limit(identifier);
  return { success, remaining };
}
