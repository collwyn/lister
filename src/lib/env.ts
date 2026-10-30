import { z } from "zod";

// Server-only configuration, validated once on first use so a missing
// variable fails with a clear message instead of a confusing runtime error.
const schema = z.object({
  APP_BASE_URL: z.string().url(),
  ADMIN_PASSWORD_HASH: z.string().min(20, "ADMIN_PASSWORD_HASH is missing (npm run hash-password)"),
  SESSION_SECRET: z.string().min(32, "SESSION_SECRET must be at least 32 characters"),
  ENCRYPTION_KEY: z.string().min(32, "ENCRYPTION_KEY is missing"),
  DATABASE_URL: z.string().min(1),

  // Endpoint and keys for the public photos bucket (and for both buckets
  // unless the S3_ORIGINALS_* overrides below are set).
  S3_ENDPOINT: z.string().url(),
  S3_REGION: z.string().default("auto"),
  S3_ACCESS_KEY_ID: z.string().min(1),
  S3_SECRET_ACCESS_KEY: z.string().min(1),
  // Optional: separate endpoint/keys for the private originals bucket.
  S3_ORIGINALS_ENDPOINT: z.string().url().optional().or(z.literal("").transform(() => undefined)),
  S3_ORIGINALS_ACCESS_KEY_ID: z.string().optional().transform((v) => v || undefined),
  S3_ORIGINALS_SECRET_ACCESS_KEY: z.string().optional().transform((v) => v || undefined),
  S3_BUCKET_ORIGINALS: z.string().min(1),
  S3_BUCKET_PUBLIC: z.string().min(1),
  PUBLIC_PHOTO_BASE_URL: z.string().url(),

  ANTHROPIC_API_KEY: z.string().min(1),
  CLAUDE_MODEL: z.string().optional(),

  EBAY_ENV: z.enum(["sandbox", "production"]).default("sandbox"),
  EBAY_CLIENT_ID: z.string().min(1),
  EBAY_CLIENT_SECRET: z.string().min(1),
  EBAY_RUNAME: z.string().min(1),
  EBAY_MARKETPLACE_ID: z.string().default("EBAY_US"),
  EBAY_VERIFICATION_TOKEN: z.string().min(32).max(80),
});

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

export function env(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((i) => `  ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Listing Desk is missing configuration:\n${problems}\nSee .env.example.`);
  }
  cached = {
    ...parsed.data,
    APP_BASE_URL: parsed.data.APP_BASE_URL.replace(/\/$/, ""),
    PUBLIC_PHOTO_BASE_URL: parsed.data.PUBLIC_PHOTO_BASE_URL.replace(/\/$/, ""),
  };
  return cached;
}

export const claudeModel = () => env().CLAUDE_MODEL || "claude-sonnet-5-5";
