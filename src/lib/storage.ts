import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
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

const clients = new Map<"originals" | "public", { client: S3Client; bucket: string }>();

function bucket(which: "originals" | "public") {
  const hit = clients.get(which);
  if (hit) return hit;
  const c = bucketConfigs(env())[which];
  const entry = {
    bucket: c.bucket,
    client: new S3Client({
      endpoint: c.endpoint,
      region: c.region,
      forcePathStyle: true,
      credentials: { accessKeyId: c.accessKeyId, secretAccessKey: c.secretAccessKey },
    }),
  };
  clients.set(which, entry);
  return entry;
}

export async function putOriginal(key: string, body: Buffer, contentType: string) {
  const b = bucket("originals");
  await b.client.send(new PutObjectCommand({ Bucket: b.bucket, Key: key, Body: body, ContentType: contentType }));
}

export async function putPublic(key: string, body: Buffer, contentType = "image/jpeg") {
  const b = bucket("public");
  await b.client.send(
    new PutObjectCommand({
      Bucket: b.bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
      CacheControl: "public, max-age=31536000, immutable",
    }),
  );
}

export async function getPublicBytes(key: string): Promise<Buffer> {
  const b = bucket("public");
  const res = await b.client.send(new GetObjectCommand({ Bucket: b.bucket, Key: key }));
  const bytes = await res.Body?.transformToByteArray();
  if (!bytes) throw new Error(`Empty object: ${key}`);
  return Buffer.from(bytes);
}

/** Public HTTPS URL eBay downloads listing photos from. */
export function publicUrl(key: string): string {
  return `${env().PUBLIC_PHOTO_BASE_URL}/${key}`;
}
