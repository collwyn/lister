"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { CachedAspect, CachedCondition, Comp } from "@/db/schema";
import type { loadItem } from "@/lib/items";

type Loaded = NonNullable<Awaited<ReturnType<typeof loadItem>>>;
type Policy = { id: string; name: string };
type Category = { categoryId: string; name: string; namePath: string; aspects: CachedAspect[]; conditions: CachedCondition[] };
type Suggestion = { categoryId: string; name: string; path: string };

const TITLE_MAX = 80;

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? `Request failed (${res.status})`);
  return json as T;
}

export function DraftEditor({
  initial,
  autoDraft,
  defaultShippingPolicyId,
  ebayConnected,
}: {
  initial: Loaded;
  autoDraft: boolean;
  defaultShippingPolicyId: string | null;
  ebayConnected: boolean;
}) {
  const router = useRouter();
  const { item, photos, draft, listing } = initial;

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
  const [weightOz, setWeightOz] = useState(draft?.weightOz ? String(Number(draft.weightOz)) : "");
  const [tested, setTested] = useState<string>(item.tested ?? "");
  const [note, setNote] = useState(item.notesToAi ?? "");

  const [category, setCategory] = useState<Category | null>(null);
  const [policies, setPolicies] = useState<Policy[] | null>(null);
  const [busy, setBusy] = useState<null | "draft" | "save" | "publish" | "status">(null);
  const [error, setError] = useState<string | null>(item.status === "failed" || listing?.error ? item.error : null);
  const [notice, setNotice] = useState<string | null>(null);
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
    api<{ shipping: Policy[] }>("/api/ebay/policies")
      .then((p) => setPolicies(p.shipping))
      .catch(() => setPolicies([]));
  }, [ebayConnected]);

  // ---- actions ----
  const writeDraft = useCallback(async () => {
    setBusy("draft");
    setError(null);
    setNotice(null);
    try {
      await api(`/api/items/${item.id}/draft`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tested: tested || null, notesToAi: note.trim() || null }),
      });
      window.location.href = `/items/${item.id}`;
    } catch (e) {
      setError((e as Error).message);
      setBusy(null);
    }
  }, [item.id, tested, note]);

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
      weightOz: weightOz ? Number(weightOz) : null,
    };
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
      const res = await api<{ url: string }>(`/api/items/${item.id}/publish`, { method: "POST" });
      setNotice(`Listed on eBay: ${res.url}`);
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

  const listed = item.status === "listed";
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
      {listed && listing?.url && !notice && (
        <p className="ok">
          Listed on eBay ({listing.environment}): <a href={listing.url} target="_blank" rel="noopener noreferrer">{listing.url}</a>
        </p>
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
                    Tested? (electronics)
                    <select
                      id="tested"
                      value={tested}
                      disabled={listed}
                      onChange={(e) => {
                        setTested(e.target.value);
                        api(`/api/items/${item.id}`, {
                          method: "PATCH",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ tested: e.target.value || null }),
                        }).catch((err) => setError((err as Error).message));
                      }}
                    >
                      <option value="">Not applicable / not set</option>
                      <option value="works">Tested, works</option>
                      <option value="not_working">Tested, doesn't work</option>
                      <option value="untested">Not tested</option>
                    </select>
                  </label>
                </div>
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
                <PriceContext comps={comps} confidence={draft.priceConfidence} soldSearch={soldSearch} />
                <label className="field" htmlFor="shipping">
                  Shipping policy
                  <select id="shipping" value={shippingPolicyId ?? ""} onChange={(e) => touch(setShippingPolicyId)(e.target.value || null)} disabled={listed || !policies}>
                    <option value="">{policies ? "Choose…" : ebayConnected ? "Loading your policies…" : "Connect eBay in Settings first"}</option>
                    {(policies ?? []).map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </label>
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
          If it's electronics: tested?
          <select id="tested-pre" value={tested} onChange={(e) => setTested(e.target.value)}>
            <option value="">Not applicable / not set</option>
            <option value="works">Tested, works</option>
            <option value="not_working">Tested, doesn't work</option>
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
