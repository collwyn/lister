import { SignJWT, jwtVerify } from "jose";

// Single-user login. The session is a signed JWT in an httpOnly cookie.
// This file must stay edge-safe (no Node APIs): middleware imports it.

export const SESSION_COOKIE = "ld_session";
const MAX_AGE_SECONDS = 60 * 60 * 24 * 14; // two weeks

function secretKey(secret: string) {
  return new TextEncoder().encode(secret);
}

export async function createSessionToken(secret: string): Promise<string> {
  return new SignJWT({ sub: "owner" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE_SECONDS}s`)
    .sign(secretKey(secret));
}

export async function verifySessionToken(token: string | undefined, secret: string | undefined): Promise<boolean> {
  if (!token || !secret) return false;
  try {
    await jwtVerify(token, secretKey(secret), { algorithms: ["HS256"] });
    return true;
  } catch {
    return false;
  }
}

export const sessionCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  maxAge: MAX_AGE_SECONDS,
};
