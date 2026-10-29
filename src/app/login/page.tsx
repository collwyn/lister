"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";

function LoginForm() {
  const params = useSearchParams();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    if (res.ok) {
      const next = params.get("next");
      window.location.href = next && next.startsWith("/") ? next : "/";
    } else {
      setError((await res.json().catch(() => ({}))).error ?? "Sign-in failed.");
      setBusy(false);
    }
  }

  return (
    <form className="panel" onSubmit={submit}>
      <h1>Listing Desk</h1>
      <label className="field" htmlFor="password">
        Password
        <input id="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
      </label>
      {error && <p className="error">{error}</p>}
      <button className="btn primary" disabled={busy || !password}>
        {busy ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}

export default function LoginPage() {
  return (
    <main className="wrap login">
      <Suspense>
        <LoginForm />
      </Suspense>
    </main>
  );
}
