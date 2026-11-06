import jsQR from "jsqr";
import sharp from "sharp";

// Divider cards mark "a new item starts after this photo". Detected locally,
// with no Claude call:
// - the printable Listing Desk card carries a QR code reading DIVIDER_QR_TEXT;
// - any bright orange card filling most of the frame also counts.
// Claude's grouping check can still catch a divider these miss (see check.ts).

export const DIVIDER_QR_TEXT = "LISTING-DESK:NEXT-ITEM";

/** qr; color (orange, not yet confirmed); color-ok (confirmed by Claude); claude (found by the grouping check); manual. */
export type DividerSource = "qr" | "color" | "color-ok" | "claude" | "manual";

/** Share of pixels that are a saturated orange (hue ~10–40°), from raw RGB(A) pixels. Pure, unit-tested. */
export function orangeShare(pixels: Uint8Array | Buffer, channels: number): number {
  let orange = 0;
  const total = Math.floor(pixels.length / channels);
  for (let i = 0; i < pixels.length; i += channels) {
    const r = pixels[i] / 255;
    const g = pixels[i + 1] / 255;
    const b = pixels[i + 2] / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const sat = max === 0 ? 0 : (max - min) / max;
    if (max !== r || max < 0.55 || sat < 0.55) continue;
    // Hue in degrees for a red-dominant pixel.
    const hue = (60 * (g - b)) / (max - min || 1);
    if (hue >= 10 && hue <= 42) orange++;
  }
  return total ? orange / total : 0;
}

/** How much of the frame must be orange for a plain card to count as a divider. */
export const ORANGE_THRESHOLD = 0.45;

export async function detectDivider(jpeg: Buffer): Promise<DividerSource | null> {
  // QR: decode a moderately sized grayscale-friendly copy. jsQR wants RGBA.
  for (const size of [1000, 1600]) {
    const { data, info } = await sharp(jpeg)
      .resize({ width: size, height: size, fit: "inside", withoutEnlargement: true })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const code = jsQR(new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), info.width, info.height, {
      inversionAttempts: "dontInvert",
    });
    if (code?.data.trim() === DIVIDER_QR_TEXT) return "qr";
  }

  // Plain orange card: look at a tiny copy of the centre 80% of the frame.
  const meta = await sharp(jpeg).metadata();
  const w = meta.width ?? 0;
  const h = meta.height ?? 0;
  if (!w || !h) return null;
  const { data, info } = await sharp(jpeg)
    .extract({ left: Math.round(w * 0.1), top: Math.round(h * 0.1), width: Math.round(w * 0.8), height: Math.round(h * 0.8) })
    .resize(64, 64, { fit: "fill" })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return orangeShare(data, info.channels) >= ORANGE_THRESHOLD ? "color" : null;
}
