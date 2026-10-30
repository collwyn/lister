import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { env } from "./env";

// Sevalla object storage is S3-compatible (Cloudflare R2 underneath).
// Two buckets: private originals, public resized listing photos.

let client: S3Client | null = null;

function s3(): S3Client {
  if (client) return client;
  const e = env();
  client = new S3Client({
    endpoint: e.S3_ENDPOINT,
    region: e.S3_REGION,
    forcePathStyle: true,
    credentials: { accessKeyId: e.S3_ACCESS_KEY_ID, secretAccessKey: e.S3_SECRET_ACCESS_KEY },
  });
  return client;
}

export async function putOriginal(key: string, body: Buffer, contentType: string) {
  await s3().send(new PutObjectCommand({ Bucket: env().S3_BUCKET_ORIGINALS, Key: key, Body: body, ContentType: contentType }));
}

export async function putPublic(key: string, body: Buffer, contentType = "image/jpeg") {
  await s3().send(
    new PutObjectCommand({
      Bucket: env().S3_BUCKET_PUBLIC,
      Key: key,
      Body: body,
      ContentType: contentType,
      CacheControl: "public, max-age=31536000, immutable",
    }),
  );
}

export async function getPublicBytes(key: string): Promise<Buffer> {
  const res = await s3().send(new GetObjectCommand({ Bucket: env().S3_BUCKET_PUBLIC, Key: key }));
  const bytes = await res.Body?.transformToByteArray();
  if (!bytes) throw new Error(`Empty object: ${key}`);
  return Buffer.from(bytes);
}

/** Public HTTPS URL eBay downloads listing photos from. */
export function publicUrl(key: string): string {
  return `${env().PUBLIC_PHOTO_BASE_URL}/${key}`;
}
