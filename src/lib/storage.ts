import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { env, type Env } from "./env";

// Sevalla object storage is S3-compatible (Cloudflare R2 underneath).
// Two buckets: private originals, public resized listing photos. Sevalla gives
// each bucket its own keys, so each bucket can have its own endpoint and keys;
// the originals bucket falls back to the shared S3_* values when not set.

export type BucketConfig = {
  bucket: string;
  endpoint: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
};

/** Works out each bucket's connection settings. Pure, so it is unit-tested. */
export function bucketConfigs(
  e: Pick<
    Env,
    | "S3_ENDPOINT"
    | "S3_REGION"
    | "S3_ACCESS_KEY_ID"
    | "S3_SECRET_ACCESS_KEY"
    | "S3_ORIGINALS_ENDPOINT"
    | "S3_ORIGINALS_ACCESS_KEY_ID"
    | "S3_ORIGINALS_SECRET_ACCESS_KEY"
    | "S3_BUCKET_ORIGINALS"
    | "S3_BUCKET_PUBLIC"
  >,
): { originals: BucketConfig; public: BucketConfig } {
  const ownKey = !!e.S3_ORIGINALS_ACCESS_KEY_ID;
  const ownSecret = !!e.S3_ORIGINALS_SECRET_ACCESS_KEY;
  if (ownKey !== ownSecret) {
    throw new Error(
      "Set both S3_ORIGINALS_ACCESS_KEY_ID and S3_ORIGINALS_SECRET_ACCESS_KEY for the originals bucket, or leave both empty.",
    );
  }
  return {
    public: {
      bucket: e.S3_BUCKET_PUBLIC,
      endpoint: e.S3_ENDPOINT,
      region: e.S3_REGION,
      accessKeyId: e.S3_ACCESS_KEY_ID,
      secretAccessKey: e.S3_SECRET_ACCESS_KEY,
    },
    originals: {
      bucket: e.S3_BUCKET_ORIGINALS,
      endpoint: e.S3_ORIGINALS_ENDPOINT ?? e.S3_ENDPOINT,
      region: e.S3_REGION,
      accessKeyId: e.S3_ORIGINALS_ACCESS_KEY_ID ?? e.S3_ACCESS_KEY_ID,
      secretAccessKey: e.S3_ORIGINALS_SECRET_ACCESS_KEY ?? e.S3_SECRET_ACCESS_KEY,
    },
  };
}

type Which = "originals" | "public";

const LABEL: Record<Which, string> = { originals: "private originals", public: "public photos" };

/** The settings to check when a bucket refuses a request. */
export function bucketVariables(which: Which, ownOriginalsKeys: boolean): string[] {
  if (which === "public") return ["S3_BUCKET_PUBLIC", "S3_ENDPOINT", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"];
  return ownOriginalsKeys
    ? ["S3_BUCKET_ORIGINALS", "S3_ORIGINALS_ENDPOINT (S3_ENDPOINT is used if it's empty)", "S3_ORIGINALS_ACCESS_KEY_ID", "S3_ORIGINALS_SECRET_ACCESS_KEY"]
    : ["S3_BUCKET_ORIGINALS", "S3_ENDPOINT, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY (shared, since S3_ORIGINALS_* are empty)"];
}

/** A storage failure that says which bucket, what went wrong, and what to check. */
export class StorageError extends Error {
  constructor(
    public which: Which,
    public bucketName: string,
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = "StorageError";
  }
}

/** Turns a raw S3 error into a readable one. Pure, so it is unit-tested. */
export function describeStorageError(
  err: unknown,
  ctx: { which: Which; bucket: string; action: string; ownOriginalsKeys: boolean },
): StorageError {
  const e = err as { name?: string; Code?: string; message?: string };
  const code = e?.Code || e?.name || "Error";
  const label = LABEL[ctx.which];
  const vars = bucketVariables(ctx.which, ctx.ownOriginalsKeys).join(", ");
  let text: string;
  if (["AccessDenied", "InvalidAccessKeyId", "SignatureDoesNotMatch", "Forbidden", "Unauthorized"].includes(code)) {
    text =
      `The ${label} bucket "${ctx.bucket}" refused the app's keys (${code}) while trying to ${ctx.action}. ` +
      `Check ${vars} in Sevalla (bucket Settings → Details and Access keys). The most common cause is using the display name: ` +
      `use the "Bucket name" from Details, which ends in a short suffix (e.g. photos-x7k2m).`;
  } else if (code === "NoSuchBucket") {
    text = `There is no bucket named "${ctx.bucket}" at that endpoint (${ctx.which} bucket). Copy the "Bucket name" from the bucket's Settings → Details (not the display name) into ${
      ctx.which === "public" ? "S3_BUCKET_PUBLIC" : "S3_BUCKET_ORIGINALS"
    }.`;
  } else {
    text = `Couldn't ${ctx.action} in the ${label} bucket "${ctx.bucket}": ${e?.message || code}. Check ${vars}.`;
  }
  return new StorageError(ctx.which, ctx.bucket, code, text);
}

const clients = new Map<Which, { client: S3Client; bucket: string; ownOriginalsKeys: boolean }>();

function bucket(which: Which) {
  const hit = clients.get(which);
  if (hit) return hit;
  const e = env();
  const c = bucketConfigs(e)[which];
  const entry = {
    bucket: c.bucket,
    ownOriginalsKeys: !!e.S3_ORIGINALS_ACCESS_KEY_ID,
    client: new S3Client({
      endpoint: c.endpoint,
      region: c.region,
      forcePathStyle: true,
      credentials: { accessKeyId: c.accessKeyId, secretAccessKey: c.secretAccessKey },
      // Sevalla's docs (Cloudflare R2): only send/check checksums when an operation requires them.
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
    }),
  };
  clients.set(which, entry);
  return entry;
}

/** Runs one storage request, turning failures into a StorageError that names the bucket. */
async function onBucket<T>(which: Which, action: string, fn: (b: { client: S3Client; bucket: string }) => Promise<T>): Promise<T> {
  const b = bucket(which);
  try {
    return await fn(b);
  } catch (err) {
    throw describeStorageError(err, { which, bucket: b.bucket, action, ownOriginalsKeys: b.ownOriginalsKeys });
  }
}

export async function putOriginal(key: string, body: Buffer, contentType: string) {
  await onBucket("originals", "save an original photo", (b) =>
    b.client.send(new PutObjectCommand({ Bucket: b.bucket, Key: key, Body: body, ContentType: contentType })),
  );
}

export async function putPublic(key: string, body: Buffer, contentType = "image/jpeg") {
  await onBucket("public", "save a listing photo", (b) =>
    b.client.send(
      new PutObjectCommand({
        Bucket: b.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
        CacheControl: "public, max-age=31536000, immutable",
      }),
    ),
  );
}

export async function getPublicBytes(key: string): Promise<Buffer> {
  return onBucket("public", "read a listing photo", async (b) => {
    const res = await b.client.send(new GetObjectCommand({ Bucket: b.bucket, Key: key }));
    const bytes = await res.Body?.transformToByteArray();
    if (!bytes) throw new Error(`Empty object: ${key}`);
    return Buffer.from(bytes);
  });
}

/** Public HTTPS URL eBay downloads listing photos from. */
export function publicUrl(key: string): string {
  return `${env().PUBLIC_PHOTO_BASE_URL}/${key}`;
}

export type StorageCheck = { which: Which; label: string; bucket: string; ok: boolean; steps: { step: string; ok: boolean; detail?: string }[] };

/**
 * Settings "Check photo storage": writes a tiny test file to each bucket, checks
 * the public one can be read from its public address (what eBay does), then
 * cleans up. Reports each step so a failure points at one setting.
 */
export async function checkStorage(): Promise<StorageCheck[]> {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const results: StorageCheck[] = [];

  for (const which of ["originals", "public"] as const) {
    const b = bucket(which);
    const key = `_storage-check/${stamp}.txt`;
    const body = `Listing Desk storage check ${stamp}`;
    const steps: StorageCheck["steps"] = [];

    try {
      await onBucket(which, "write a test file", (x) =>
        x.client.send(new PutObjectCommand({ Bucket: x.bucket, Key: key, Body: body, ContentType: "text/plain" })),
      );
      steps.push({ step: "Write a test file", ok: true });

      if (which === "public") {
        const url = publicUrl(key);
        try {
          const res = await fetch(url, { cache: "no-store" });
          const text = res.ok ? await res.text() : "";
          const ok = res.ok && text === body;
          steps.push({
            step: "Read it from the public address (as eBay will)",
            ok,
            detail: ok
              ? url
              : `${url} answered ${res.status}. Turn on public access for "${b.bucket}" and check PUBLIC_PHOTO_BASE_URL matches its public address.`,
          });
        } catch (err) {
          steps.push({
            step: "Read it from the public address (as eBay will)",
            ok: false,
            detail: `Couldn't reach ${url} (${(err as Error).message}). Check PUBLIC_PHOTO_BASE_URL.`,
          });
        }
      }

      try {
        await b.client.send(new DeleteObjectCommand({ Bucket: b.bucket, Key: key }));
      } catch {
        // Keys without delete permission are fine for the app; leave the tiny test file.
      }
    } catch (err) {
      steps.push({ step: "Write a test file", ok: false, detail: (err as Error).message });
    }

    results.push({ which, label: LABEL[which], bucket: b.bucket, ok: steps.every((s) => s.ok), steps });
  }
  return results;
}
