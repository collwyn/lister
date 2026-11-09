"use client";

import { api } from "@/lib/client-api";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { CachedAspect, CachedCondition, Comp } from "@/db/schema";
import type { loadItem } from "@/lib/items";

type Loaded = NonNullable<Awaited<ReturnType<typeof loadItem>>>;
type Policy = { id: string; name: string; immediatePay?: boolean; pickupOnly?: boolean };
type Policies = { payment: Policy[]; returns: Policy[]; shipping: Policy[] };
type Defaults = { paymentPolicyId: string | null; pickupPaymentPolicyId: string | null; returnPolicyId: string | null };
type Category = { categoryId: string; name: string; namePath: string; aspects: CachedAspect[]; conditions: CachedCondition[] };
type Suggestion = { categoryId: string; name: string; path: string };

const TITLE_MAX = 80;


export function DraftEditor({
  initial,
  autoDraft,
  defaultShippingPolicyId,
  defaults,
  ebayConnected,
}: {
  initial: Loaded;
  autoDraft: boolean;
  defaultShippingPolicyId: string | null;
  defaults: Defaults;
  ebayConnected: boolean;
}) {
  const router = useRouter();
  const { item, photos, draft, listing, blockingListingId } = initial;

  // ---- editable state (seeded from the latest draft) ----
  const [title, setTitle] = useState(draft?.title ?? "");
  const [description, setDescription] = useState(draft?.description ?? "");
  const [categoryId, setCategoryId] = useState<string | null>(draft?.categoryId ?? null);
  const [categoryName, setCategoryName] = useState<string | null>(draft?.categoryName ?? null);
  const [conditionId, setConditionId] = useState<string | null>(draft?.conditionId ?? null);
  const [conditionNotes, setConditionNotes] = useState(draft?.conditionNotes ?? "");
  const [aspects, setAspects] = useState<Record<string, string[]>>(draft?.aspects ?? {});
  const [price, setPrice] = useState(draft?.price ? String(Number(draft.price)) : "");
  const [quantity, setQuantity] = useState(String(draft?.quantity ?? 1));
  const [shippingPolicyId, setShippingPolicyId] = useState<string | null>(draft?.shippingPolicyId ?? defaultShippingPolicyId);
  // null = use the Settings default
  const [paymentPolicyId, setPaymentPolicyId] = useState<string | null>(draft?.paymentPolicyId ?? null);
  const [returnPolicyId, setReturnPolicyId] = useState<string | null>(draft?.returnPolicyId ?? null);
  const [weightOz, setWeightOz] = useState(draft?.weightOz ? String(Number(draft.weightOz)) : "");
  const [dimL, setDimL] = useState(draft?.dims ? String(draft.dims.lengthIn) : "");
  const [dimW, setDimW] = useState(draft?.dims ? String(draft.dims.widthIn) : "");
  const [dimH, setDimH] = useState(draft?.dims ? String(draft.dims.heightIn) : "");
  // Unset means the default: used and in working order.
  const [tested, setTested] = useState<string>(item.tested ?? "works");
  const [note, setNote] = useState(item.notesToAi ?? "");

  const [category, setCategory] = useState<Category | null>(null);
  const [policies, setPolicies] = useState<Policies | null>(null);
  const [busy, setBusy] = useState<null | "draft" | "save" | "publish" | "status">(null);
  const [error, setError] = useState<string | null>(item.status === "failed" || listing?.error ? item.error : null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [dirty, setDirty] = useState(false);
  const touch = <T,>(set: (v: T) => void) => (v: T) => {
    set(v);
    setDirty(true);
  };

  // ---- load category specifics/conditions and shipping policies ----
  const loadCategory = useCallback(async (id: string, name?: string, path?: string) => {
    const q = name ? `?name=${encodeURIComponent(name)}&path=${encodeURIComponent(path ?? name)}` : "";
    const { category } = await api<{ category: Category }>(`/api/ebay/category/${id}${q}`);
    setCategory(category);
    return category;
  }, []);

  useEffect(() => {
    if (draft?.categoryId) loadCategory(draft.categoryId).catch((e) => setError(e.message));
  }, [draft?.categoryId, loadCategory]);

  useEffect(() => {
    if (!ebayConnected) return;
    api<Policies>("/api/ebay/policies")
      .then(setPolicies)
      .catch(() => setPolicies({ payment: [], returns: [], shipping: [] }));
  }, [ebayConnected]);

  // ---- actions ----
  // Redrafting keeps a condition you picked, so the new description matches it.
  const keepCondition = !!conditionId && !!draft && (conditionId !== draft.conditionId || draft.source === "edit");
  const conditionChanged = !!conditionId && !!draft && conditionId !== draft.conditionId;

  const writeDraft = useCallback(async () => {
    setBusy("draft");
    setError(null);
    setNotice(null);
    try {
      await api(`/api/items/${item.id}/draft`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tested: tested || null, notesToAi: note.trim() || null, conditionId: keepCondition ? conditionId : null }),
      });
      window.location.href = `/items/${item.id}`;
    } catch (e) {
      setError((e as Error).message);
      setBusy(null);
    }
  }, [item.id, tested, note, keepCondition, conditionId]);

  const started = useRef(false);
  useEffect(() => {
    if (autoDraft && !started.current) {
      started.current = true;
      writeDraft();
    }
  }, [autoDraft, writeDraft]);

  function editPayload() {
    return {
      title,
      description,
      categoryId,
      categoryName,
      conditionId,
      conditionNotes: conditionNotes.trim() || null,
      aspects,
      price: price ? Number(price) : null,
      quantity: Math.max(1, Math.round(Number(quantity) || 1)),
      shippingPolicyId,
      paymentPolicyId,
      returnPolicyId,
      weightOz: weightOz ? Number(weightOz) : null,
      dims: dimsValue(),
    };
  }

  /** Box size: all three numbers, or none. */
  function dimsValue() {
    const nums = [dimL, dimW, dimH].map((v) => Number(v));
    if (![dimL, dimW, dimH].some((v) => v.trim())) return null;
    if (nums.some((n) => !(n > 0))) throw new Error("Enter all three box measurements in inches, or clear all three.");
    const [lengthIn, widthIn, heightIn] = nums;
    return { lengthIn, widthIn, heightIn };
  }

  async function save(): Promise<boolean> {
    setBusy("save");
    setError(null);
    try {
      await api(`/api/items/${item.id}/draft`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editPayload()),
      });
      setDirty(false);
      setNotice("Saved.");
      router.refresh();
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function publish() {
    if (dirty && !(await save())) return;
    setBusy("publish");
    setError(null);
    setNotice(null);
    try {
      const res = await api<{ url: string | null; listingId: string; warnings?: string[] }>(`/api/items/${item.id}/publish`, { method: "POST" });
      setNotice(res.url ? `Listed on eBay: ${res.url}` : `Test listing ${res.listingId} recorded. Test mode: nothing was sent to eBay.`);
      if (res.warnings?.length) setError(`Listed, with eBay notes: ${res.warnings.join(" ")}`);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
      router.refresh(); // shows the "end the earlier listing" option if eBay called this a duplicate
    } finally {
      setBusy(null);
    }
  }

  async function markEnded() {
    setBusy("status");
    setError(null);
    try {
      await api(`/api/items/${item.id}/ended`, { method: "POST" });
      window.location.reload();
    } catch (e) {
      setError((e as Error).message);
      setBusy(null);
    }
  }

  /** Ends the listing on eBay itself: this item's current listing, or the older one blocking a relist. */
  async function endOnEbay(listingId?: string) {
    setBusy("status");
    setError(null);
    setNotice(null);
    try {
      const res = await api<{ listingId: string; alreadyEnded: boolean }>(`/api/items/${item.id}/end`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(listingId ? { listingId } : {}),
      });
      setNotice(
        `${res.alreadyEnded ? `eBay listing ${res.listingId} had already ended.` : `Ended eBay listing ${res.listingId}.`} ` +
          (listingId ? "You can now approve and list this item again." : "The item is back in review, ready to list again."),
      );
      setConfirmEnd(false);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function setStatus(status: "held" | "rejected" | "needs_review") {
    setBusy("status");
    try {
      await api(`/api/items/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      router.push("/");
    } catch (e) {
      setError((e as Error).message);
      setBusy(null);
    }
  }

  async function pickCategory(s: Suggestion) {
    setCategoryId(s.categoryId);
    setCategoryName(s.path);
    setDirty(true);
    try {
      const c = await loadCategory(s.categoryId, s.name, s.path);
      // Keep specifics that still exist in the new category.
      const names = new Set(c.aspects.map((a) => a.name));
      setAspects((prev) => Object.fromEntries(Object.entries(prev).filter(([k]) => names.has(k))));
      if (conditionId && !c.conditions.some((x) => x.conditionId === conditionId)) setConditionId(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  // Listed in the CURRENT eBay environment (a test-mode listing doesn't lock the item).
  const listed = item.status === "listed" && !!listing?.ebayListingId;
  const photoUrls = photos.filter((p) => p.url && !p.isDivider);
  const flags = (item.flags as string[]) ?? [];
  const comps = (draft?.comps ?? []) as Comp[];
  const soldSearch = title ? `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(title)}&LH_Sold=1&LH_Complete=1` : null;

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div className="spread">
        <h1>{draft?.title || "New item"}</h1>
        <span className={`pill ${item.status}`}>{item.status.replace("_", " ")}</span>
      </div>

      {error && <p className="error">{error}</p>}
      {notice && <p className="ok">{notice.startsWith("Listed") ? <ListedNotice text={notice} /> : notice}</p>}
      {listed && !notice && (
        <p className="ok">
          {listing?.url ? (
            <>
              Listed on eBay ({listing.environment}): <a href={listing.url} target="_blank" rel="noopener noreferrer">{listing.url}</a>
            </>
          ) : (
            <>Test listing {listing?.ebayListingId} recorded. Test mode: nothing was sent to eBay.</>
          )}
        </p>
      )}
      {listed && (
        <details>
          <summary className="small">End this listing</summary>
          <div className="row" style={{ marginTop: 8 }}>
            <p className="muted small" style={{ flex: "1 1 320px" }}>
              <strong>End listing on eBay</strong> takes it off eBay now and puts the item back in review, so you can edit and list it again.
            </p>
            <button className={confirmEnd ? "btn danger" : "btn"} onClick={() => (confirmEnd ? endOnEbay() : setConfirmEnd(true))} disabled={busy !== null}>
              {busy === "status" ? "Ending…" : confirmEnd ? "Yes, end it on eBay" : "End listing on eBay"}
            </button>
          </div>
          <div className="row" style={{ marginTop: 8 }}>
            <p className="muted small" style={{ flex: "1 1 320px" }}>
              Already ended it in Seller Hub? <strong>Clear listing</strong> only updates the app; nothing is changed on eBay.
            </p>
            <button className="btn" onClick={markEnded} disabled={busy !== null}>
              Clear listing and edit again
            </button>
          </div>
        </details>
      )}
      {!listed && blockingListingId && !notice && (
        <div className="panel">
          <p style={{ marginTop: 0 }}>
            eBay won&apos;t list this again while your earlier listing <strong>{blockingListingId}</strong> for this item is still up. End that one on eBay,
            then press <strong>Approve and list on eBay</strong> again.
          </p>
          <button className="btn primary" onClick={() => endOnEbay(blockingListingId)} disabled={busy !== null}>
            {busy === "status" ? "Ending…" : `End listing ${blockingListingId} on eBay`}
          </button>
        </div>
      )}

      <div className="editor">
        <section className="panel sticky">
          <h3>Photos</h3>
          <div className="photos">
            {photoUrls.map((p, i) => (
              <img key={p.id} src={p.url!} alt={`Photo ${i + 1}`} className={i === 0 ? "cover" : undefined} />
            ))}
          </div>
          <p className="muted small">The first photo is the gallery photo on eBay.</p>
        </section>

        <div style={{ display: "grid", gap: 16, minWidth: 0 }}>
          {!draft ? (
            <section className="panel">
              <h2>{busy === "draft" ? "Claude is writing the draft…" : "Write the draft"}</h2>
              <p className="muted">
                {busy === "draft"
                  ? "Identifying the item, finding its eBay category and comparable listings, then writing. Usually 30–90 seconds."
                  : "Claude identifies the item, picks the eBay category, fills item specifics and suggests a price."}
              </p>
              <RedraftFields tested={tested} setTested={setTested} note={note} setNote={setNote} />
              <div className="row">
                <button className="btn primary" onClick={writeDraft} disabled={busy !== null}>
                  {busy === "draft" ? "Writing…" : "Write draft"}
                </button>
              </div>
            </section>
          ) : (
            <>
              {flags.length > 0 && !listed && (
                <ul className="flags">
                  {flags.map((f) => (
                    <li key={f}>{f}</li>
                  ))}
                </ul>
              )}
              {draft.aiNotes && !listed && <p className="muted small" style={{ whiteSpace: "pre-line" }}>{draft.aiNotes}</p>}

              <section className="panel">
                <label className="field" htmlFor="title">
                  <span className="spread">
                    Title
                    <span className={`mono ${title.length > TITLE_MAX ? "req" : ""}`}>
                      {title.length}/{TITLE_MAX}
                    </span>
                  </span>
                  <input id="title" value={title} onChange={(e) => touch(setTitle)(e.target.value)} disabled={listed} />
                </label>

                <CategoryField current={categoryName} onPick={pickCategory} disabled={listed} />

                <div className="grid2">
                  <label className="field" htmlFor="condition">
                    Condition
                    <select id="condition" value={conditionId ?? ""} onChange={(e) => touch(setConditionId)(e.target.value || null)} disabled={listed}>
                      <option value="">Choose…</option>
                      {(category?.conditions ?? []).map((c) => (
                        <option key={c.conditionId} value={c.conditionId}>
                          {c.conditionDescription}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field" htmlFor="tested">
                    Working order
                    <select
                      id="tested"
                      value={tested}
                      disabled={listed}
                      onChange={(e) => {
                        setTested(e.target.value);
                        api(`/api/items/${item.id}`, {
                          method: "PATCH",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ tested: e.target.value }),
                        }).catch((err) => setError((err as Error).message));
                      }}
                    >
                      <option value="works">Used, works (default)</option>
                      <option value="not_working">Doesn't work (for parts)</option>
                      <option value="untested">Not tested</option>
                    </select>
                  </label>
                </div>
                {conditionChanged && !listed && (
                  <div className="row" style={{ gridColumn: "1 / -1" }}>
                    <p className="muted small" style={{ flex: "1 1 320px", margin: 0 }}>
                      The description and condition notes were written for the earlier condition. Rewrite the draft to match the new one (Claude rewrites the
                      whole draft; your other unsaved edits are replaced).
                    </p>
                    <button className="btn" onClick={writeDraft} disabled={busy !== null}>
                      {busy === "draft" ? "Rewriting…" : "Rewrite for this condition"}
                    </button>
                  </div>
                )}
                <label className="field" htmlFor="condnotes">
                  Condition notes
                  <input id="condnotes" value={conditionNotes} onChange={(e) => touch(setConditionNotes)(e.target.value)} disabled={listed} />
                </label>
              </section>

              <section className="panel">
                <h3>Item specifics</h3>
                {category ? (
                  <AspectsEditor aspects={category.aspects} values={aspects} onChange={touch(setAspects)} disabled={listed} />
                ) : (
                  <p className="muted small">Loading this category's item specifics…</p>
                )}
              </section>

              <section className="panel">
                <label className="field" htmlFor="description">
                  Description
                  <textarea id="description" value={description} onChange={(e) => touch(setDescription)(e.target.value)} disabled={listed} />
                </label>
                <p className="muted small">Blank lines start new paragraphs; lines starting with “- ” become bullets.</p>
              </section>

              <section className="panel">
                <div className="grid3">
                  <label className="field" htmlFor="price">
                    Price (USD)
                    <input id="price" inputMode="decimal" className="mono" value={price} onChange={(e) => touch(setPrice)(e.target.value)} disabled={listed} />
                  </label>
                  <label className="field" htmlFor="quantity">
                    Quantity
                    <input id="quantity" inputMode="numeric" className="mono" value={quantity} onChange={(e) => touch(setQuantity)(e.target.value)} disabled={listed} />
                  </label>
                  <label className="field" htmlFor="weight">
                    Packed weight (oz)
                    <input id="weight" inputMode="decimal" className="mono" value={weightOz} onChange={(e) => touch(setWeightOz)(e.target.value)} disabled={listed} />
                  </label>
                </div>
                <div className="grid3">
                  <label className="field" htmlFor="dim-l">
                    Box length (in)
                    <input id="dim-l" inputMode="decimal" className="mono" value={dimL} onChange={(e) => touch(setDimL)(e.target.value)} disabled={listed} />
                  </label>
                  <label className="field" htmlFor="dim-w">
                    Box width (in)
                    <input id="dim-w" inputMode="decimal" className="mono" value={dimW} onChange={(e) => touch(setDimW)(e.target.value)} disabled={listed} />
                  </label>
                  <label className="field" htmlFor="dim-h">
                    Box height (in)
                    <input id="dim-h" inputMode="decimal" className="mono" value={dimH} onChange={(e) => touch(setDimH)(e.target.value)} disabled={listed} />
                  </label>
                </div>
                <p className="muted small">Weight and box size are used by calculated-shipping policies; flat-rate and local-pickup policies ignore them. 1 lb = 16 oz.</p>
                <PriceContext comps={comps} confidence={draft.priceConfidence} soldSearch={soldSearch} />
                <PolicyFields
                  policies={policies}
                  ebayConnected={ebayConnected}
                  disabled={listed}
                  defaults={defaults}
                  shippingPolicyId={shippingPolicyId}
                  paymentPolicyId={paymentPolicyId}
                  returnPolicyId={returnPolicyId}
                  onShipping={touch(setShippingPolicyId)}
                  onPayment={touch(setPaymentPolicyId)}
                  onReturns={touch(setReturnPolicyId)}
                />
              </section>

              {!listed && (
                <section className="panel">
                  <div className="row">
                    <button className="btn primary" onClick={publish} disabled={busy !== null}>
                      {busy === "publish" ? "Publishing…" : "Approve and list on eBay"}
                    </button>
                    <button className="btn" onClick={save} disabled={busy !== null || !dirty}>
                      {busy === "save" ? "Saving…" : "Save changes"}
                    </button>
                    <button className="btn" onClick={() => setStatus("held")} disabled={busy !== null}>
                      Hold
                    </button>
                    <button className="btn danger" onClick={() => setStatus("rejected")} disabled={busy !== null}>
                      Don't sell
                    </button>
                  </div>
                  <details>
                    <summary className="small">Redo the draft with a note to Claude</summary>
                    <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
                      <RedraftFields tested={tested} setTested={setTested} note={note} setNote={setNote} hideTested />
                      <div>
                        <button className="btn" onClick={writeDraft} disabled={busy !== null}>
                          {busy === "draft" ? "Redrafting…" : "Redo draft"}
                        </button>
                      </div>
                    </div>
                  </details>
                </section>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function ListedNotice({ text }: { text: string }) {
  const url = text.replace(/^Listed on eBay:\s*/, "");
  return (
    <>
      Listed on eBay:{" "}
      <a href={url} target="_blank" rel="noopener noreferrer">
        {url}
      </a>
    </>
  );
}

function RedraftFields({
  tested,
  setTested,
  note,
  setNote,
  hideTested,
}: {
  tested: string;
  setTested: (v: string) => void;
  note: string;
  setNote: (v: string) => void;
  hideTested?: boolean;
}) {
  return (
    <div className="grid2">
      {!hideTested && (
        <label className="field" htmlFor="tested-pre">
          Working order
          <select id="tested-pre" value={tested} onChange={(e) => setTested(e.target.value)}>
            <option value="works">Used, works (default)</option>
            <option value="not_working">Doesn't work (for parts)</option>
            <option value="untested">Not tested</option>
          </select>
        </label>
      )}
      <label className="field" htmlFor="note" style={hideTested ? { gridColumn: "1 / -1" } : undefined}>
        Note to Claude (optional)
        <input id="note" placeholder="e.g. it's the 2019 model; includes original box" value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
    </div>
  );
}

function CategoryField({ current, onPick, disabled }: { current: string | null; onPick: (s: Suggestion) => void; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Suggestion[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function search(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    try {
      const { suggestions } = await api<{ suggestions: Suggestion[] }>(`/api/ebay/categories?q=${encodeURIComponent(q)}`);
      setResults(suggestions);
    } catch (e2) {
      setErr((e2 as Error).message);
    }
  }

  return (
    <div className="field" style={{ display: "grid", gap: 6 }}>
      <span className="spread">
        <span style={{ fontSize: 13, fontWeight: 600, color: "var(--muted)" }}>eBay category</span>
        {!disabled && (
          <button type="button" className="btn" style={{ minHeight: 28, padding: "2px 10px", fontSize: 13 }} onClick={() => setOpen(!open)}>
            {open ? "Close" : "Change"}
          </button>
        )}
      </span>
      <span>{current ?? "None chosen"}</span>
      {open && (
        <div style={{ display: "grid", gap: 8 }}>
          <form onSubmit={search} className="row">
            <input aria-label="Search eBay categories" placeholder="Describe the item, e.g. 'vintage brass table lamp'" value={q} onChange={(e) => setQ(e.target.value)} style={{ flex: 1 }} />
            <button className="btn" disabled={!q.trim()}>
              Search
            </button>
          </form>
          {err && <p className="error">{err}</p>}
          {results && (
            <div className="suggestions">
              {results.length === 0 && <p className="muted small">No categories matched. Try other words.</p>}
              {results.map((s) => (
                <button
                  key={s.categoryId}
                  type="button"
                  onClick={() => {
                    onPick(s);
                    setOpen(false);
                  }}
                >
                  {s.path}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function AspectsEditor({
  aspects,
  values,
  onChange,
  disabled,
}: {
  aspects: CachedAspect[];
  values: Record<string, string[]>;
  onChange: (v: Record<string, string[]>) => void;
  disabled?: boolean;
}) {
  const [showAll, setShowAll] = useState(false);
  const ordered = useMemo(
    () =>
      [...aspects].sort(
        (a, b) => Number(b.required) - Number(a.required) || Number(b.usage === "RECOMMENDED") - Number(a.usage === "RECOMMENDED"),
      ),
    [aspects],
  );
  const filled = (a: CachedAspect) => (values[a.name] ?? []).length > 0;
  const visible = showAll ? ordered : ordered.filter((a) => a.required || a.usage === "RECOMMENDED" || filled(a));

  function set(name: string, raw: string) {
    const list = raw
      .split(/\s*;\s*/)
      .map((s) => s.trim())
      .filter(Boolean);
    const next = { ...values };
    if (list.length) next[name] = list;
    else delete next[name];
    onChange(next);
  }

  return (
    <>
      <div className="aspects">
        {visible.map((a) => {
          const id = `aspect-${a.name.replace(/[^a-z0-9]/gi, "-")}`;
          const value = (values[a.name] ?? []).join("; ");
          const missing = a.required && !filled(a);
          return (
            <label key={a.name} className="field" htmlFor={id}>
              <span>
                {a.name} {a.required && <span className="req">*</span>}
                {a.multi && <span className="muted small"> (separate with ;)</span>}
              </span>
              {a.mode === "SELECTION_ONLY" && !a.multi && a.values.length > 0 ? (
                <select id={id} value={value} onChange={(e) => set(a.name, e.target.value)} disabled={disabled} style={missing ? { borderColor: "var(--bad)" } : undefined}>
                  <option value="">—</option>
                  {a.values.map((v) => (
                    <option key={v} value={v}>
                      {v}
                    </option>
                  ))}
                </select>
              ) : (
                <>
                  <input id={id} list={`${id}-values`} value={value} onChange={(e) => set(a.name, e.target.value)} disabled={disabled} style={missing ? { borderColor: "var(--bad)" } : undefined} />
                  {a.values.length > 0 && (
                    <datalist id={`${id}-values`}>
                      {a.values.map((v) => (
                        <option key={v} value={v} />
                      ))}
                    </datalist>
                  )}
                </>
              )}
            </label>
          );
        })}
      </div>
      {ordered.length > visible.length && !showAll && (
        <button type="button" className="btn" onClick={() => setShowAll(true)}>
          Show all {ordered.length} item specifics
        </button>
      )}
    </>
  );
}

function PriceContext({ comps, confidence, soldSearch }: { comps: Comp[]; confidence: string | null; soldSearch: string | null }) {
  const prices = comps.map((c) => c.price).sort((a, b) => a - b);
  const mid = prices.length ? prices[Math.floor(prices.length / 2)] : null;
  return (
    <details>
      <summary className="small">
        Price confidence: <strong>{confidence ?? "unknown"}</strong>
        {mid !== null && ` · ${comps.length} active listings, median $${mid.toFixed(2)}`}
      </summary>
      <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
        <p className="muted small">These are asking prices of current listings; sold prices usually run lower.</p>
        <div className="comps">
          {comps.map((c, i) => (
            <a key={i} href={c.url} target="_blank" rel="noopener noreferrer">
              <span className="mono">${c.price.toFixed(2)}</span>
              <span className="muted">{c.condition}</span>
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.title}</span>
            </a>
          ))}
        </div>
        {soldSearch && (
          <a href={soldSearch} target="_blank" rel="noopener noreferrer" className="small">
            Check eBay sold listings for this title
          </a>
        )}
      </div>
    </details>
  );
}

const policyTag = (p: Policy) => (p.immediatePay ? " (immediate payment)" : p.pickupOnly ? " (local pickup only)" : "");

/** Shipping, payment and return policies for this item. Payment and returns default to Settings. */
function PolicyFields(props: {
  policies: Policies | null;
  ebayConnected: boolean;
  disabled: boolean;
  defaults: Defaults;
  shippingPolicyId: string | null;
  paymentPolicyId: string | null;
  returnPolicyId: string | null;
  onShipping: (v: string | null) => void;
  onPayment: (v: string | null) => void;
  onReturns: (v: string | null) => void;
}) {
  const { policies, defaults } = props;
  const loading = !policies;
  const placeholder = props.ebayConnected ? "Loading your policies…" : "Connect eBay in Settings first";
  const name = (list: Policy[] | undefined, id: string | null) => list?.find((p) => p.id === id)?.name;
  const shipping = policies?.shipping.find((p) => p.id === props.shippingPolicyId);
  const pickup = !!shipping?.pickupOnly;
  // What "Default" means for payment on this item, as publishing will decide it.
  const autoPaymentId = pickup && defaults.pickupPaymentPolicyId ? defaults.pickupPaymentPolicyId : defaults.paymentPolicyId;
  const payment = policies?.payment.find((p) => p.id === (props.paymentPolicyId ?? autoPaymentId));
  const clash = pickup && payment?.immediatePay;

  const select = (
    id: string,
    label: string,
    value: string | null,
    onChange: (v: string | null) => void,
    list: Policy[] | undefined,
    empty: string,
  ) => (
    <label className="field" htmlFor={id}>
      {label}
      <select id={id} value={value ?? ""} onChange={(e) => onChange(e.target.value || null)} disabled={props.disabled || loading}>
        <option value="">{loading ? placeholder : empty}</option>
        {(list ?? []).map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
            {policyTag(p)}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <>
      {select("shipping", "Shipping policy", props.shippingPolicyId, props.onShipping, policies?.shipping, "Choose…")}
      <div className="grid2">
        {select(
          "payment",
          "Payment policy",
          props.paymentPolicyId,
          props.onPayment,
          policies?.payment,
          `Default${name(policies?.payment, autoPaymentId) ? ` (${name(policies?.payment, autoPaymentId)})` : ""}`,
        )}
        {select(
          "returns",
          "Return policy",
          props.returnPolicyId,
          props.onReturns,
          policies?.returns,
          `Default${name(policies?.returns, defaults.returnPolicyId) ? ` (${name(policies?.returns, defaults.returnPolicyId)})` : ""}`,
        )}
      </div>
      {clash && (
        <p className="error small">
          This item is local pickup only, and eBay won&apos;t accept a payment policy that requires immediate payment with it. Choose a payment policy
          without immediate payment{props.paymentPolicyId ? "" : ", or set one under Settings → Payment for local pickup items"}.
        </p>
      )}
    </>
  );
}
