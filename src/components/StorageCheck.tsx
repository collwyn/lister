"use client";

import { useState } from "react";

type Result = {
  which: "originals" | "public";
  label: string;
  bucket: string;
  ok: boolean;
  steps: { step: string; ok: boolean; detail?: string }[];
};

export function StorageCheck() {
  const [results, setResults] = useState<Result[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    setError(null);
    setResults(null);
    try {
      const res = await fetch("/api/storage/check", { method: "POST" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? `Check failed (${res.status})`);
      setResults(json.results);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel">
      <h2>Photo storage</h2>
      <p className="muted">Writes a small test file to each bucket and checks eBay will be able to read listing photos. Nothing else is changed.</p>
      <div>
        <button className="btn primary" onClick={run} disabled={busy}>
          {busy ? "Checking…" : "Check photo storage"}
        </button>
      </div>
      {error && <p className="error">{error}</p>}
      {results?.map((r) => (
        <div key={r.which} className={r.ok ? "ok" : "error"} style={{ display: "grid", gap: 4 }}>
          <strong>
            {r.ok ? "✓" : "✗"} {r.label[0].toUpperCase() + r.label.slice(1)} bucket <code>{r.bucket}</code>
          </strong>
          {r.steps.map((s) => (
            <div key={s.step} className="small" style={{ overflowWrap: "anywhere" }}>
              {s.ok ? "✓" : "✗"} {s.step}
              {s.detail && <>: {s.detail}</>}
            </div>
          ))}
        </div>
      ))}
    </section>
  );
}
