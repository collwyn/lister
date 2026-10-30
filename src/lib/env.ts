import { z } from "zod";

// Server-only configuration, validated once on first use so a missing
// variable fails with a clear message instead of a confusing runtime error.
const schema = z.object({
  APP_BASE_URL: z.string().url(),
  ADMIN_PASSWORD_HASH: z.string().min(20, "ADMIN_PASSWORD_HASH is missing (npm run hash-password)"),
  SESSION_SECRET: z.string().min(32, "SESSION_SECRET must be at least 32 characters"),
  ENCRYPTION_KEY: z.string().min(32, "ENCRYPTION_KEY is missing"),
  DATABASE_URL: z.string().min(1),

  S3_ENDPOINT: z.string().url(),
  S3_REGION: z.string().default("auto"),
  S3_ACCESS_KEY_ID: z.string().min(1),
  S3_SECRET_ACCESS_KEY: z.string().min(1),
  S3_BUCKET_ORIGINALS: z.string().min(1),
  S3_BUCKET_PUBLIC: z.string().min(1),
  PUBLIC_PHOTO_BASE_URL: z.string().url(),

  ANTHROPIC_API_KEY: z.string().min(1),
  CLAUDE_MODEL: z.string().optional(),

  // "mock" answers eBay calls locally (src/lib/ebay/mock.ts) so the app can be
  // tested before eBay approves a developer account. The keys below are then optional.
  EBAY_ENV: z.enum(["mock", "sandbox", "production"]).default("sandbox"),
  EBAY_CLIENT_ID: z.string().min(1).optional(),
  EBAY_CLIENT_SECRET: z.string().min(1).optional(),
  EBAY_RUNAME: z.string().min(1).optional(),
  EBAY_MARKETPLACE_ID: z.string().default("EBAY_US"),
  EBAY_VERIFICATION_TOKEN: z.string().min(32).max(80).optional(),
}).superRefine((v, ctx) => {
  if (v.EBAY_ENV === "mock") return;
  for (const key of ["EBAY_CLIENT_ID", "EBAY_CLIENT_SECRET", "EBAY_RUNAME", "EBAY_VERIFICATION_TOKEN"] as const) {
    if (!v[key]) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [key], message: `required when EBAY_ENV is ${v.EBAY_ENV}` });
  }
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

export const isMockEbay = () => env().EBAY_ENV === "mock";

/** eBay keys, guaranteed present outside test mode (checked in env()). */
export function ebayKeys() {
  const e = env();
  if (e.EBAY_ENV === "mock") throw new Error("eBay keys aren't used in test mode.");
  return {
    clientId: e.EBAY_CLIENT_ID!,
    clientSecret: e.EBAY_CLIENT_SECRET!,
    ruName: e.EBAY_RUNAME!,
  };
}
