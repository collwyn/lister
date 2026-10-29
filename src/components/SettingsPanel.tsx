"use client";

import { useEffect, useState } from "react";

type Policy = { id: string; name: string };
type Saved = { paymentPolicyId: string | null; returnPolicyId: string | null; defaultShippingPolicyId: string | null; locationKey: string | null };

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? `Request failed (${res.status})`);
  return json as T;
}
const post = (url: string, body?: unknown) =>
  api(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}) });

export function SettingsPanel(props: {
  environment: "sandbox" | "production";
  connected: boolean;
  refreshExpires: string | null;
  saved: Saved;
  deletionEndpoint: string;
  callbackUrl: string;
  justConnected: boolean;
  connectError: string | null;
}) {
  const [policies, setPolicies] = useState<{ payment: Policy[]; returns: Policy[]; shipping: Policy[] } | null>(null);
  const [choice, setChoice] = useState(props.saved);
  const [loc, setLoc] = useState({ name: "Home", city: "", stateOrProvince: "", postalCode: "" });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(
    props.connectError ? { ok: false, text: props.connectError } : props.justConnected ? { ok: true, text: "eBay connected." } : null,
  );
  const [busy, setBusy] = useState<string | null>(null);

  async function loadPolicies() {
    try {
      setPolicies(await api("/api/ebay/policies"));
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    }
  }
  useEffect(() => {
    if (props.connected) loadPolicies();
  }, [props.connected]);

  async function run(label: string, fn: () => Promise<unknown>, done: string) {
    setBusy(label);
    setMsg(null);
    try {
      await fn();
      setMsg({ ok: true, text: done });
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  }

  const select = (key: keyof Saved, list: Policy[] | undefined, label: string) => (
    <label className="field" htmlFor={key}>
      {label}
      <select id={key} value={choice[key] ?? ""} onChange={(e) => setChoice({ ...choice, [key]: e.target.value || null })}>
        <option value="">Choose…</option>
        {(list ?? []).map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <div style={{ display: "grid", gap: 16 }}>
      {msg && <p className={msg.ok ? "ok" : "error"}>{msg.text}</p>}

      <section className="panel">
        <h2>1. Connect eBay ({props.environment})</h2>
        {props.connected ? (
          <p>
            Connected.{" "}
            {props.refreshExpires && <span className="muted">Reconnect before {new Date(props.refreshExpires).toLocaleDateString()}.</span>}
          </p>
        ) : (
          <p className="muted">Sign in to the eBay seller account you'll list from and approve access.</p>
        )}
        <div className="row">
          <a className="btn primary" href="/api/ebay/connect">
            {props.connected ? "Reconnect eBay" : "Connect eBay"}
          </a>
        </div>
        <p className="muted small">
          In your eBay developer account, set the RuName's auth accepted URL to <code>{props.callbackUrl}</code>
        </p>
      </section>

      <section className="panel">
        <h2>2. Business policies</h2>
        <p className="muted">Every listing needs a payment, a return and a shipping policy. Create them in Seller Hub, then pick defaults here.</p>
        <div className="row">
          <button className="btn" disabled={!props.connected || busy !== null} onClick={() => run("optin", () => post("/api/ebay/opt-in"), "Business policies are turned on for this account.")}>
            Turn on business policies
          </button>
          <button className="btn" disabled={!props.connected || busy !== null} onClick={loadPolicies}>
            Reload policies
          </button>
          {props.environment === "sandbox" && (
            <button
              className="btn"
              disabled={!props.connected || busy !== null}
              onClick={() =>
                run(
                  "starter",
                  async () => {
                    await post("/api/ebay/starter-policies");
                    window.location.reload();
                  },
                  "Created sandbox test policies.",
                )
              }
            >
              Create sandbox test policies
            </button>
          )}
        </div>
        <div className="grid3">
          {select("paymentPolicyId", policies?.payment, "Payment")}
          {select("returnPolicyId", policies?.returns, "Returns")}
          {select("defaultShippingPolicyId", policies?.shipping, "Default shipping")}
        </div>
        <div>
          <button
            className="btn primary"
            disabled={busy !== null || !choice.paymentPolicyId || !choice.returnPolicyId || !choice.defaultShippingPolicyId}
            onClick={() =>
              run(
                "save",
                () =>
                  post("/api/ebay/settings", {
                    paymentPolicyId: choice.paymentPolicyId,
                    returnPolicyId: choice.returnPolicyId,
                    defaultShippingPolicyId: choice.defaultShippingPolicyId,
                  }),
                "Policies saved.",
              )
            }
          >
            Save policies
          </button>
        </div>
      </section>

      <section className="panel">
        <h2>3. Ship-from location</h2>
        {props.saved.locationKey ? <p>Location saved.</p> : <p className="muted">eBay needs the city and ZIP code you ship from.</p>}
        <div className="grid3">
          <label className="field" htmlFor="city">
            City
            <input id="city" value={loc.city} onChange={(e) => setLoc({ ...loc, city: e.target.value })} />
          </label>
          <label className="field" htmlFor="state">
            State (2 letters)
            <input id="state" maxLength={2} value={loc.stateOrProvince} onChange={(e) => setLoc({ ...loc, stateOrProvince: e.target.value.toUpperCase() })} />
          </label>
          <label className="field" htmlFor="zip">
            ZIP code
            <input id="zip" inputMode="numeric" value={loc.postalCode} onChange={(e) => setLoc({ ...loc, postalCode: e.target.value })} />
          </label>
        </div>
        <div>
          <button className="btn primary" disabled={!props.connected || busy !== null || !loc.city || !loc.postalCode} onClick={() => run("loc", () => post("/api/ebay/location", loc), "Location saved.")}>
            Save location
          </button>
        </div>
      </section>

      <section className="panel">
        <h2>4. Account deletion endpoint</h2>
        <p className="muted">
          eBay keeps production keys switched off until this endpoint is registered. On eBay's developer site, open Alerts &amp; Notifications, choose Marketplace Account Deletion, and enter:
        </p>
        <p>
          Endpoint: <code>{props.deletionEndpoint}</code>
        </p>
        <p className="muted small">Verification token: the value of EBAY_VERIFICATION_TOKEN in your Sevalla environment variables.</p>
      </section>
    </div>
  );
}
