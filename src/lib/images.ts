import sharp from "sharp";

// Turns any uploaded photo (JPEG, PNG, WebP, iPhone HEIC) into a
// listing-ready JPEG: upright, sRGB, 1600 px on the long edge, metadata stripped.

export const LISTING_LONG_EDGE = 1600;

export function isHeic(fileName: string, mimeType: string): boolean {
  return /image\/hei[cf]/i.test(mimeType) || /\.hei[cf]$/i.test(fileName);
}

async function heicToJpeg(input: Buffer): Promise<Buffer> {
  // heic-convert is pure JS/wasm; sharp's prebuilt binaries can't decode HEIC.
  const { default: convert } = await import("heic-convert");
  const out = await convert({ buffer: input, format: "JPEG", quality: 0.92 });
  return Buffer.from(out as ArrayBuffer);
}

export type ProcessedPhoto = {
  listing: Buffer; // resized JPEG for the public bucket and for Claude
  width: number;
  height: number;
  takenAt: Date | null;
};

export async function processPhoto(input: Buffer, fileName: string, mimeType: string): Promise<ProcessedPhoto> {
  const source = isHeic(fileName, mimeType) ? await heicToJpeg(input) : input;

  const meta = await sharp(source).metadata();
  const takenAt = exifDate(meta.exif);

  const { data, info } = await sharp(source)
    .rotate() // apply EXIF orientation
    .resize({ width: LISTING_LONG_EDGE, height: LISTING_LONG_EDGE, fit: "inside", withoutEnlargement: true })
    .toColourspace("srgb")
    .jpeg({ quality: 86, mozjpeg: true })
    .toBuffer({ resolveWithObject: true });

  return { listing: data, width: info.width, height: info.height, takenAt };
}

/** Pulls DateTimeOriginal out of a raw EXIF block without a full EXIF parser. */
export function exifDate(exif: Buffer | undefined): Date | null {
  if (!exif) return null;
  const m = exif.toString("latin1").match(/(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/);
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m;
  const date = new Date(`${y}-${mo}-${d}T${h}:${mi}:${s}`);
  return Number.isNaN(date.getTime()) ? null : date;
}
