import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const saved = { ...process.env };

beforeEach(() => {
  vi.resetModules();
  Object.assign(process.env, {
    APP_BASE_URL: "https://lister.example",
    ADMIN_PASSWORD_HASH: "$2b$12$" + "x".repeat(53),
    SESSION_SECRET: "s".repeat(44),
    ENCRYPTION_KEY: "k".repeat(44),
    DATABASE_URL: "postgres://x",
    S3_ENDPOINT: "https://s3.example",
    S3_ACCESS_KEY_ID: "a",
    S3_SECRET_ACCESS_KEY: "b",
    S3_BUCKET_ORIGINALS: "o",
    S3_BUCKET_PUBLIC: "p",
    PUBLIC_PHOTO_BASE_URL: "https://p.example",
    ANTHROPIC_API_KEY: "x",
    EBAY_ENV: "sandbox",
    EBAY_CLIENT_ID: "id",
    EBAY_CLIENT_SECRET: "secret",
    EBAY_RUNAME: "runame",
    EBAY_VERIFICATION_TOKEN: "t".repeat(40),
  });
});
afterEach(() => {
  process.env = { ...saved };
  vi.unstubAllGlobals();
});

describe("eBay request headers", () => {
  it("send Accept-Language en-US (Node's default '*' is rejected by eBay)", async () => {
    let sent: Headers | undefined;
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      sent = new Headers(init.headers);
      return new Response(JSON.stringify({ listingId: "1" }), { status: 200 });
    });
    const { ebayFetch } = await import("@/lib/ebay/http");
    await ebayFetch("/sell/inventory/v1/offer/O1/publish", "token", { method: "POST", body: {} });
    expect(sent?.get("accept-language")).toBe("en-US");
    expect(sent?.get("content-language")).toBe("en-US");
    expect(sent?.get("x-ebay-c-marketplace-id")).toBe("EBAY_US");
  });

  it("send it on GET requests too", async () => {
    let sent: Headers | undefined;
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      sent = new Headers(init.headers);
      return new Response("{}", { status: 200 });
    });
    const { ebayFetch } = await import("@/lib/ebay/http");
    await ebayFetch("/sell/account/v1/payment_policy", "token");
    expect(sent?.get("accept-language")).toBe("en-US");
  });

  it("send it on eBay's token (sign-in) request too", async () => {
    let sent: Headers | undefined;
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      sent = new Headers(init.headers);
      return new Response(JSON.stringify({ access_token: "a", expires_in: 7200 }), { status: 200 });
    });
    vi.doMock("@/lib/db", () => ({ db: () => ({}), schema: {} }));
    const { appToken } = await import("@/lib/ebay/auth");
    await appToken();
    expect(sent?.get("accept-language")).toBe("en-US");
  });
});
