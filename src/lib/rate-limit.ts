/**
 * In-process sliding window guarding photo uploads. It does not hold across
 * serverless instances, which is acceptable for a throttle. The claim endpoint
 * is deliberately not rate limited: it must do zero external calls.
 */
const memory = new Map<string, number[]>();

export async function rateLimit(
  name: string,
  identifier: string,
  max: number,
  windowSeconds: number,
): Promise<{ success: boolean; remaining: number }> {
  const key = `${name}:${identifier}`;
  const now = Date.now();
  const hits = (memory.get(key) ?? []).filter((t) => t > now - windowSeconds * 1000);

  const success = hits.length < max;
  if (success) hits.push(now);
  memory.set(key, hits);
  return { success, remaining: max - hits.length };
}
