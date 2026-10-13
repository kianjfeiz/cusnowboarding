import sharp from "sharp";
import { describe, expect, test, vi } from "vitest";
import { generateThumbnails, makeThumbnail, thumbnailKeyFor } from "@/lib/photos/thumbnails";

describe("thumbnails", () => {
  test("shrinks to fit 640px and bakes in the phone's rotation flag", async () => {
    // Stored landscape with "rotate 90" in EXIF - how a phone saves a portrait shot.
    const original = await sharp({
      create: { width: 2000, height: 1000, channels: 3, background: "#88aacc" },
    })
      .jpeg()
      .withMetadata({ orientation: 6 })
      .toBuffer();

    const meta = await sharp(await makeThumbnail(original)).metadata();
    expect(meta.format).toBe("webp");
    expect([meta.width, meta.height]).toEqual([320, 640]);
  });

  test("never enlarges a photo that is already small", async () => {
    const small = await sharp({
      create: { width: 300, height: 200, channels: 3, background: "#ffffff" },
    })
      .png()
      .toBuffer();

    const meta = await sharp(await makeThumbnail(small)).metadata();
    expect([meta.width, meta.height]).toEqual([300, 200]);
  });

  test("sits beside its original in the bucket", () => {
    expect(thumbnailKeyFor("trips/abc/123.jpg")).toBe("trips/abc/123.thumb.webp");
    expect(thumbnailKeyFor("trips/abc/123.HEIC")).toBe("trips/abc/123.thumb.webp");
  });

  test("does nothing without a bucket", async () => {
    vi.stubEnv("R2_BUCKET", "");
    expect(await generateThumbnails(["00000000-0000-0000-0000-000000000000"])).toBe(0);
    vi.unstubAllEnvs();
  });
});
