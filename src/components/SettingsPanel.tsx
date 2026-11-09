"use client";

import { api } from "@/lib/client-api";

import { useEffect, useState } from "react";

type Policy = { id: string; name: string; immediatePay?: boolean; pickupOnly?: boolean };
type Saved = {
  paymentPolicyId: string | null;
  pickupPaymentPolicyId: string | null;
  returnPolicyId: string | null;
  defaultShippingPolicyId: string | null;
  locationKey: string | null;
  postalCode: string | null;
  city: string | null;
  stateOrProvince: string | null;
};

const post = (url: string, body?: unknown) =>
  api(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}) });

export function SettingsPanel(props: {
  environment: "mock" | "sandbox" | "production";
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
  const [loc, setLoc] = useState({
    name: "Home",
    city: props.saved.city ?? "",
    stateOrProvince: props.saved.stateOrProvince ?? "",
    postalCode: props.saved.postalCode ?? "",
  });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(
    props.connectError ? { ok: false, text: props.connectError } : props.justConnected ? { ok: true, text: "eBay connected." } : null,
  );
  const [busy, setBusy] = useState<string | null>(null);

  async function loadPolicies() {
    try {
      setPolicies(await api("/api/ebay/policies"));
    } catch (e) {
      setMsg({
        ok: false,
        text: `Couldn't load your eBay policies. ${(e as Error).message} If this account hasn't used business policies yet, click "Turn on business policies" below, then "Reload policies".`,
      });
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

  const tag = (p: Policy) => (p.immediatePay ? " (immediate payment)" : p.pickupOnly ? " (local pickup only)" : "");
  const select = (key: keyof Saved, list: Policy[] | undefined, label: string, empty = "Choose…") => (
    <label className="field" htmlFor={key}>
      {label}
      <select id={key} value={choice[key] ?? ""} onChange={(e) => setChoice({ ...choice, [key]: e.target.value || null })}>
        <option value="">{empty}</option>
        {(list ?? []).map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
            {tag(p)}
          </option>
        ))}
      </select>
    </label>
  );
  const pickupShipping = (policies?.shipping ?? []).filter((p) => p.pickupOnly);
  const pickupPaymentChoices = (policies?.payment ?? []).filter((p) => !p.immediatePay);
  const pickupChoice = (policies?.payment ?? []).find((p) => p.id === choice.pickupPaymentPolicyId);

  return (
    <div style={{ display: "grid", gap: 16 }}>
      {msg && <p className={msg.ok ? "ok" : "error"}>{msg.text}</p>}

      <section className="panel">
        <h2>1. Connect eBay ({props.environment === "mock" ? "test mode" : props.environment})</h2>
        {props.environment === "mock" && (
          <p className="ok">
            Test mode: eBay is simulated, so you can try uploads, Claude's drafts, review and publishing before eBay approves your developer account.
            Categories are a small test set, there are no price comparisons, and nothing is sent to eBay.
          </p>
        )}
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
          {props.environment !== "production" && (
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
                  "Created test policies.",
                )
              }
            >
              Create test policies
            </button>
          )}
        </div>
        <div className="grid3">
          {select("paymentPolicyId", policies?.payment, "Payment")}
          {select("returnPolicyId", policies?.returns, "Returns")}
          {select("defaultShippingPolicyId", policies?.shipping, "Default shipping")}
        </div>
        {pickupShipping.length > 0 && (
          <div style={{ display: "grid", gap: 6 }}>
            {select("pickupPaymentPolicyId", pickupPaymentChoices, "Payment for local pickup items", "Same as Payment")}
            <p className="muted small" style={{ margin: 0 }}>
              eBay doesn&apos;t allow immediate payment on local-pickup-only listings ({pickupShipping.map((p) => p.name).join(", ")}). Items with that
              shipping policy are listed with this payment policy instead.
              {pickupPaymentChoices.length === 0 &&
                " None of your payment policies qualify yet: in Seller Hub, create one with \"Require immediate payment\" turned off, then Reload policies."}
              {pickupChoice?.immediatePay && " The policy chosen requires immediate payment, so it won't work for pickup."}
            </p>
          </div>
        )}
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
                    pickupPaymentPolicyId: choice.pickupPaymentPolicyId,
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
        {props.saved.postalCode ? (
          <p>
            Saved: {[props.saved.city, props.saved.stateOrProvince].filter(Boolean).join(", ")} {props.saved.postalCode}. Buyers see this area, and it's
            where local pickup happens.
          </p>
        ) : props.saved.locationKey ? (
          <p className="error">Save your location again: listings now need the ZIP code stored with it.</p>
        ) : (
          <p className="muted">eBay needs the city and ZIP code you ship from. Buyers see this area, and it's where local pickup happens.</p>
        )}
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
