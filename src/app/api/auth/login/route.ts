import bcrypt from "bcryptjs";
import { NextResponse } from "next/server";
import { z } from "zod";
import { env } from "@/lib/env";
import { handle } from "@/lib/api";
import { SESSION_COOKIE, createSessionToken, sessionCookieOptions } from "@/lib/session";

// Small delay on failure slows down password guessing.
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const POST = handle(async (req: Request) => {
  const { password } = z.object({ password: z.string().min(1, "Enter your password.") }).parse(await req.json());
  const e = env();
  const ok = await bcrypt.compare(password, e.ADMIN_PASSWORD_HASH);
  if (!ok) {
    await pause(800);
    return NextResponse.json({ error: "That password isn't right." }, { status: 401 });
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, await createSessionToken(e.SESSION_SECRET), sessionCookieOptions);
  return res;
});
