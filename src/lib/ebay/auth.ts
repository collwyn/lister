import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { decrypt, encrypt } from "@/lib/crypto";
import { env } from "@/lib/env";
import { ebayHosts } from "./http";

// Two kinds of eBay token:
// - Application token (client credentials): public data such as categories and price comps.
// - User token (your seller account): policies, inventory, publishing. Obtained once via
//   the "Connect eBay" consent flow; the long-lived refresh token is stored encrypted.

const APP_SCOPES = ["https://api.ebay.com/oauth/api_scope"];
export const USER_SCOPES = [
  "https://api.ebay.com/oauth/api_scope",
  "https://api.ebay.com/oauth/api_scope/sell.inventory",
  "https://api.ebay.com/oauth/api_scope/sell.account",
  "https://api.ebay.com/oauth/api_scope/sell.fulfillment", // Phase 3: sold sync
];

type TokenResponse = {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  refresh_token_expires_in?: number;
};

const memo = new Map<string, { token: string; expiresAt: number }>();

function basicAuth() {
  const e = env();
  return "Basic " + Buffer.from(`${e.EBAY_CLIENT_ID}:${e.EBAY_CLIENT_SECRET}`).toString("base64");
}

async function tokenRequest(params: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(`${ebayHosts().api}/identity/v1/oauth2/token`, {
    method: "POST",
    headers: { Authorization: basicAuth(), "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params),
    cache: "no-store",
  });
  const json = (await res.json().catch(() => ({}))) as TokenResponse & { error?: string; error_description?: string };
  if (!res.ok) {
    throw new Error(`eBay sign-in failed: ${json.error_description || json.error || res.status}`);
  }
  return json;
}

function remember(key: string, t: TokenResponse) {
  memo.set(key, { token: t.access_token, expiresAt: Date.now() + (t.expires_in - 120) * 1000 });
  return t.access_token;
}

export async function appToken(): Promise<string> {
  const key = `app:${env().EBAY_ENV}`;
  const hit = memo.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.token;
  return remember(key, await tokenRequest({ grant_type: "client_credentials", scope: APP_SCOPES.join(" ") }));
}

export function consentUrl(state: string): string {
  const e = env();
  const url = new URL("/oauth2/authorize", ebayHosts().auth);
  url.searchParams.set("client_id", e.EBAY_CLIENT_ID);
  url.searchParams.set("redirect_uri", e.EBAY_RUNAME);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("state", state);
  // eBay expects spaces in the scope list as %20 (URLSearchParams would write "+").
  return `${url.toString()}&scope=${encodeURIComponent(USER_SCOPES.join(" "))}`;
}

/** Completes the consent flow: trades the one-time code for tokens and stores the refresh token. */
export async function completeConsent(code: string) {
  const e = env();
  const t = await tokenRequest({ grant_type: "authorization_code", code, redirect_uri: e.EBAY_RUNAME });
  if (!t.refresh_token) throw new Error("eBay did not return a refresh token.");
  const values = {
    refreshTokenEnc: encrypt(t.refresh_token, e.ENCRYPTION_KEY),
    refreshTokenExpires: t.refresh_token_expires_in ? new Date(Date.now() + t.refresh_token_expires_in * 1000) : null,
  };
  await db()
    .insert(schema.ebayAccount)
    .values({ environment: e.EBAY_ENV, ...values })
    .onConflictDoUpdate({ target: schema.ebayAccount.environment, set: values });
  remember(`user:${e.EBAY_ENV}`, t);
}

export async function getAccount() {
  const rows = await db().select().from(schema.ebayAccount).where(eq(schema.ebayAccount.environment, env().EBAY_ENV));
  return rows[0] ?? null;
}

export class NotConnectedError extends Error {
  constructor() {
    super("eBay isn't connected yet. Open Settings and choose Connect eBay.");
    this.name = "NotConnectedError";
  }
}

export async function userToken(): Promise<string> {
  const e = env();
  const key = `user:${e.EBAY_ENV}`;
  const hit = memo.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.token;

  const account = await getAccount();
  if (!account?.refreshTokenEnc) throw new NotConnectedError();
  const refresh = decrypt(account.refreshTokenEnc, e.ENCRYPTION_KEY);
  return remember(key, await tokenRequest({ grant_type: "refresh_token", refresh_token: refresh, scope: USER_SCOPES.join(" ") }));
}
