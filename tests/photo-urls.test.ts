import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { presignRead } from "@/lib/photos/r2";

/**
 * Signing is local HMAC work, so fake credentials are enough: nothing here
 * talks to R2.
 */
beforeAll(() => {
  vi.stubEnv("R2_ACCOUNT_ID", "test-account");
  vi.stubEnv("R2_ACCESS_KEY_ID", "test-key");
  vi.stubEnv("R2_SECRET_ACCESS_KEY", "test-secret");
  vi.stubEnv("R2_BUCKET", "test-bucket");
  vi.useFakeTimers();
});

afterAll(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("read URLs", () => {
  test("are identical within a window, so the browser can cache the image", async () => {
    vi.setSystemTime(new Date("2026-10-13T12:01:00Z"));
    const first = await presignRead("trips/a/1.jpg");
    vi.setSystemTime(new Date("2026-10-13T12:14:00Z"));
    const second = await presignRead("trips/a/1.jpg");

    expect(first).not.toBeNull();
    expect(second).toBe(first);
  });

  test("change in the next window", async () => {
    vi.setSystemTime(new Date("2026-10-13T12:14:00Z"));
    const before = await presignRead("trips/a/1.jpg");
    vi.setSystemTime(new Date("2026-10-13T12:16:00Z"));
    expect(await presignRead("trips/a/1.jpg")).not.toBe(before);
  });

  test("tell the browser it may cache, and still expire within half an hour", async () => {
    const url = new URL((await presignRead("trips/a/1.jpg"))!);
    expect(url.searchParams.get("response-cache-control")).toBe("private, max-age=900");
    expect(url.searchParams.get("X-Amz-Expires")).toBe("1800");
  });
});
