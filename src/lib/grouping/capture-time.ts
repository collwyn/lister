// When a photo was taken, from the best source available:
// 1. the photo's EXIF DateTimeOriginal (read in src/lib/images.ts),
// 2. the file name: Samsung Galaxy phones name photos by capture time
//    (20261106_141523.jpg, 20261106_141523(0).jpg, 20261106_141523_1.jpg),
//    and Pixel / most Android cameras use IMG_20261106_141523.jpg or PXL_20261106_141523123.jpg,
// 3. the file's last-modified time reported by the browser (often the capture
//    time for photos straight off a phone, but changed by copying).
//
// All three are wall-clock times without a time zone. They are parsed the same
// way (as if UTC), so comparisons and gaps between photos come out right.

export type CaptureSource = "exif" | "filename" | "modified" | "none";

const NAME_PATTERN = /(?:^|[^0-9])((?:19|20)\d{2})(\d{2})(\d{2})[_-](\d{2})(\d{2})(\d{2})(\d{0,3})/;

/** Capture time from a camera-style file name, or null. */
export function timeFromFileName(fileName: string): Date | null {
  const m = NAME_PATTERN.exec(fileName);
  if (!m) return null;
  const [, y, mo, d, h, mi, s, ms] = m;
  const date = new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +s, ms ? Number(ms.padEnd(3, "0")) : 0));
  // Reject impossible dates (e.g. month 13), which Date.UTC would roll over.
  if (date.getUTCMonth() !== +mo - 1 || date.getUTCDate() !== +d || +h > 23 || +mi > 59 || +s > 59) return null;
  return date;
}

/**
 * Samsung adds "(0)", "(1)" or "_1" when two photos share the same second.
 * Returns that counter (0 when absent) so same-second photos keep their order.
 */
export function sameSecondCounter(fileName: string): number {
  const m = /\((\d+)\)\.[a-z0-9]+$/i.exec(fileName) ?? /\d{6}_(\d{1,2})\.[a-z0-9]+$/i.exec(fileName);
  return m ? Number(m[1]) : 0;
}

/** Last-modified times from the browser are real instants; shift them to wall-clock-as-UTC like the others. */
export function wallClockFromInstant(ms: number, tzOffsetMinutes: number): Date {
  return new Date(ms - tzOffsetMinutes * 60_000);
}

export function captureTime(opts: {
  exif: Date | null;
  fileName: string;
  lastModified?: Date | null;
}): { at: Date | null; source: CaptureSource } {
  if (opts.exif) return { at: opts.exif, source: "exif" };
  const fromName = timeFromFileName(opts.fileName);
  if (fromName) return { at: fromName, source: "filename" };
  if (opts.lastModified) return { at: opts.lastModified, source: "modified" };
  return { at: null, source: "none" };
}
