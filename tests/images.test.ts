import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { LISTING_LONG_EDGE, isHeic, processPhoto } from "@/lib/images";

async function fakePhoto(width: number, height: number, format: "jpeg" | "png" = "jpeg") {
  const img = sharp({ create: { width, height, channels: 3, background: { r: 200, g: 120, b: 40 } } });
  return format === "png" ? img.png().toBuffer() : img.jpeg().toBuffer();
}

describe("processPhoto", () => {
  it("shrinks a large photo to 1600 px on the long edge, as JPEG", async () => {
    const out = await processPhoto(await fakePhoto(4032, 3024), "IMG_0001.jpg", "image/jpeg");
    expect(out.width).toBe(LISTING_LONG_EDGE);
    expect(out.height).toBe(1200);
    expect((await sharp(out.listing).metadata()).format).toBe("jpeg");
  });

  it("never enlarges a small photo", async () => {
    const out = await processPhoto(await fakePhoto(800, 600, "png"), "scan.png", "image/png");
    expect([out.width, out.height]).toEqual([800, 600]);
  });

  it("recognizes iPhone HEIC files by type or name", () => {
    expect(isHeic("IMG_1.HEIC", "")).toBe(true);
    expect(isHeic("photo", "image/heif")).toBe(true);
    expect(isHeic("photo.jpg", "image/jpeg")).toBe(false);
  });
});
