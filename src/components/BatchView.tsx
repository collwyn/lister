"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/client-api";
import { BatchUploader } from "@/components/BatchUploader";
import {
  locate,
  makeCover,
  mergeWithPrevious,
  moveToNext,
  moveToPrevious,
  putBack,
  splitAt,
  takeOut,
  type Groups,
} from "@/lib/grouping/edit";

type Photo = {
  id: string;
  fileName: string;
  url: string | null;
  thumbUrl: string | null;
  takenAt: string | null;
  isDivider: boolean;
  dividerSource: string | null;
  excluded: boolean;
  itemId: string | null;
};
type Group = { itemId: string; title: string | null; status: string; note: string | null; error: string | null; photoIds: string[] };
type Batch = { status: string; groupingError: string | null; createdAt: string; photos: Photo[]; groups: Group[] };

const STATUS_LABEL: Record<string, string> = {
  grouped: "Waiting",
  drafting: "Drafting",
  needs_review: "Needs review",
  approved: "Approved",
  listed: "Listed",
  sold: "Sold",
  held: "Held",
  rejected: "Not selling",
  failed: "Draft failed",
};

export function BatchView({ id, initial }: { id: string; initial: Batch }) {
  const router = useRouter();
  const batch = initial;
  const date = new Date(batch.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric" });

  // Poll while the server is working on this batch.
  const waiting = batch.status === "grouping" || (batch.status === "confirmed" && batch.groups.some((g) => g.status === "grouped" || g.status === "drafting"));
  useEffect(() => {
    if (!waiting) return;
    const t = setInterval(() => router.refresh(), batch.status === "grouping" ? 3000 : 8000);
    return () => clearInterval(t);
  }, [waiting, batch.status, router]);

  return (
    <>
      <div className="spread">
        <h1>Batch of {date}</h1>
        <span className="muted small">{batch.photos.length} photos</span>
      </div>
      {batch.status === "uploading" && <Uploading id={id} batch={batch} />}
      {batch.status === "grouping" && (
        <div className="panel">
          <strong>Sorting photos into items…</strong>
          <p className="muted small">Finding divider cards, then Claude checks any group it isn&apos;t sure about. This page updates by itself.</p>
        </div>
      )}
      {batch.status === "grouped" && <GroupEditor id={id} batch={batch} />}
      {batch.status === "confirmed" && <Progress batch={batch} />}
    </>
  );
}

function Uploading({ id, batch }: { id: string; batch: Batch }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(batch.groupingError);
  async function group() {
    setBusy(true);
    setError(null);
    try {
      await api(`/api/uploads/${id}/group`, { method: "POST" });
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  return (
    <>
      {error && <p className="error">{error}</p>}
      {batch.photos.length > 0 && (
        <div className="panel">
          <p>
            {batch.photos.length} photos uploaded. Add more below, or sort these into items now.
          </p>
          <div className="row">
            <button className="btn primary" onClick={group} disabled={busy}>
              {busy ? "Sorting…" : "Sort into items"}
            </button>
          </div>
        </div>
      )}
      <BatchUploader uploadId={id} startOrder={batch.photos.length} />
    </>
  );
}

function GroupEditor({ id, batch }: { id: string; batch: Batch }) {
  const router = useRouter();
  const photos = useMemo(() => new Map(batch.photos.map((p) => [p.id, p])), [batch.photos]);
  const shootingOrder = useMemo(() => batch.photos.map((p) => p.id), [batch.photos]);
  const notes = useMemo(() => new Map(batch.groups.map((g) => [g.photoIds.join(","), g.note])), [batch.groups]);

  const [groups, setGroups] = useState<Groups>(() => batch.groups.map((g) => g.photoIds).filter((g) => g.length));
  const [dividers, setDividers] = useState<string[]>(() => batch.photos.filter((p) => p.isDivider).map((p) => p.id));
  const [excluded, setExcluded] = useState<string[]>(() => batch.photos.filter((p) => p.excluded && !p.isDivider).map((p) => p.id));
  const [selected, setSelected] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<null | "save" | "confirm" | "regroup">(null);
  const [error, setError] = useState<string | null>(batch.groupingError);
  const [adding, setAdding] = useState(false);

  // Photos not in any group and not left out (e.g. uploaded after grouping) go back in by shooting order.
  useEffect(() => {
    const placed = new Set([...groups.flat(), ...dividers, ...excluded]);
    const loose = shootingOrder.filter((pid) => !placed.has(pid));
    if (loose.length) setGroups((g) => loose.reduce((acc, pid) => putBack(acc, shootingOrder, pid), g));
    // Only on first load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function edit(next: Groups) {
    setGroups(next);
    setDirty(true);
  }
  function leaveOut(pid: string, asDivider: boolean) {
    edit(takeOut(groups, pid));
    if (asDivider) setDividers((d) => [...d, pid]);
    else setExcluded((x) => [...x, pid]);
    setSelected(null);
  }
  function restore(pid: string) {
    setDividers((d) => d.filter((x) => x !== pid));
    setExcluded((x) => x.filter((y) => y !== pid));
    edit(putBack(groups, shootingOrder, pid));
  }

  async function save(confirm: boolean) {
    setBusy(confirm ? "confirm" : "save");
    setError(null);
    try {
      await api(`/api/uploads/${id}/groups`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ groups: groups.map((photoIds) => ({ photoIds })), dividers, excluded, confirm }),
      });
      setDirty(false);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function regroup() {
    if (dirty && !window.confirm("Sort again from scratch? Your changes to the groups will be lost.")) return;
    setBusy("regroup");
    setError(null);
    try {
      await api(`/api/uploads/${id}/group`, { method: "POST" });
      window.location.reload();
    } catch (e) {
      setError((e as Error).message);
      setBusy(null);
    }
  }

  const sel = selected ? photos.get(selected) : null;
  const selAt = selected ? locate(groups, selected) : null;
  const leftOut = [...dividers, ...excluded];
  const toCheck = groups.filter((g) => notes.get(g.join(","))?.startsWith("Check")).length;

  return (
    <>
      <div className="panel">
        <p>
          <strong>{groups.length} items</strong> found in {batch.photos.length} photos
          {dividers.length > 0 && ` (${dividers.length} divider cards)`}. Check the groups, fix any mistakes, then start drafting.
        </p>
        <p className="muted small">
          Tap a photo to move it, start a new item from it, or make it the main photo. The first photo of each item is its main listing photo.
          {toCheck > 0 && ` ${toCheck} group${toCheck > 1 ? "s are" : " is"} marked for checking.`}
        </p>
        {error && <p className="error">{error}</p>}
        <div className="row">
          <button className="btn primary" onClick={() => save(true)} disabled={busy !== null || groups.length === 0}>
            {busy === "confirm" ? "Starting…" : `Looks right: draft ${groups.length} items`}
          </button>
          <button className="btn" onClick={() => save(false)} disabled={busy !== null || !dirty}>
            {busy === "save" ? "Saving…" : "Save changes"}
          </button>
          <button className="btn" onClick={() => setAdding((a) => !a)} disabled={busy !== null}>
            Add more photos
          </button>
          <button className="btn" onClick={regroup} disabled={busy !== null}>
            {busy === "regroup" ? "Sorting…" : "Sort again"}
          </button>
        </div>
        {adding && (
          <>
            <p className="muted small">New photos join this batch; the app sorts the whole batch again afterwards.</p>
            <BatchUploader uploadId={id} startOrder={batch.photos.length} />
          </>
        )}
      </div>

      <div className="groups">
        {groups.map((g, gi) => {
          const note = notes.get(g.join(","));
          return (
            <section key={g[0]} className="panel group">
              <div className="spread">
                <h2>
                  Item {gi + 1} <span className="muted small">· {g.length} photo{g.length > 1 ? "s" : ""}</span>
                </h2>
                {gi > 0 && (
                  <button className="btn" onClick={() => edit(mergeWithPrevious(groups, gi))}>
                    Merge with item {gi}
                  </button>
                )}
              </div>
              {note && <p className={note.startsWith("Check") ? "flags small" : "muted small"} style={note.startsWith("Check") ? { padding: "8px 12px" } : undefined}>{note}</p>}
              {g.length > 24 && <p className="error small">eBay allows 24 photos per listing. Split this item or leave some photos out.</p>}
              <div className="strip">
                {g.map((pid, pi) => (
                  <Thumb key={pid} photo={photos.get(pid)} selected={selected === pid} cover={pi === 0} onClick={() => setSelected(selected === pid ? null : pid)} />
                ))}
              </div>
            </section>
          );
        })}
      </div>

      {leftOut.length > 0 && (
        <details className="panel">
          <summary>
            Left out: {dividers.length} divider card{dividers.length === 1 ? "" : "s"}
            {excluded.length > 0 && `, ${excluded.length} other photo${excluded.length === 1 ? "" : "s"}`}
          </summary>
          <div className="strip" style={{ marginTop: 10 }}>
            {leftOut.map((pid) => (
              <Thumb key={pid} photo={photos.get(pid)} selected={selected === pid} onClick={() => setSelected(selected === pid ? null : pid)} />
            ))}
          </div>
        </details>
      )}

      {sel && (
        <div className="actionbar">
          <div className="wrap inner">
            {sel.url && (
              <a href={sel.url} target="_blank" rel="noopener noreferrer" title="Open full size">
                <img src={sel.thumbUrl ?? sel.url} alt="" />
              </a>
            )}
            <div className="row" style={{ flex: 1 }}>
              {selAt ? (
                <>
                  {selAt.pi > 0 && (
                    <button className="btn" onClick={() => (edit(splitAt(groups, sel.id)), setSelected(null))}>
                      New item from here
                    </button>
                  )}
                  {selAt.pi > 0 && (
                    <button className="btn" onClick={() => edit(makeCover(groups, sel.id))}>
                      Main photo
                    </button>
                  )}
                  {selAt.gi > 0 && (
                    <button className="btn" onClick={() => edit(moveToPrevious(groups, sel.id))}>
                      To item {selAt.gi}
                    </button>
                  )}
                  {selAt.gi < groups.length - 1 && (
                    <button className="btn" onClick={() => edit(moveToNext(groups, sel.id))}>
                      To item {selAt.gi + 2}
                    </button>
                  )}
                  <button className="btn" onClick={() => leaveOut(sel.id, true)}>
                    It&apos;s a divider
                  </button>
                  <button className="btn danger" onClick={() => leaveOut(sel.id, false)}>
                    Leave out
                  </button>
                </>
              ) : (
                <button className="btn" onClick={() => (restore(sel.id), setSelected(null))}>
                  Put back in an item
                </button>
              )}
              <button className="btn" onClick={() => setSelected(null)} aria-label="Close">
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function Thumb({ photo, selected, cover, onClick }: { photo?: Photo; selected: boolean; cover?: boolean; onClick: () => void }) {
  if (!photo) return null;
  const time = photo.takenAt ? new Date(photo.takenAt).toISOString().slice(11, 16) : null;
  return (
    <button type="button" className={`thumbbtn${selected ? " selected" : ""}`} onClick={onClick} title={photo.fileName}>
      {photo.thumbUrl ? <img src={photo.thumbUrl} alt={photo.fileName} loading="lazy" /> : <span />}
      {cover && <span className="badge">Main</span>}
      {photo.isDivider && <span className="badge">Divider</span>}
      {time && <span className="time">{time}</span>}
    </button>
  );
}

function Progress({ batch }: { batch: Batch }) {
  const counts = batch.groups.reduce<Record<string, number>>((acc, g) => ((acc[g.status] = (acc[g.status] ?? 0) + 1), acc), {});
  const left = (counts.grouped ?? 0) + (counts.drafting ?? 0);
  const photos = new Map(batch.photos.map((p) => [p.id, p]));
  return (
    <>
      <div className="panel">
        <p>
          {left > 0 ? (
            <>
              <strong>Drafting in the background:</strong> {batch.groups.length - left} of {batch.groups.length} items done. You can leave this page;
              drafting carries on.
            </>
          ) : (
            <>
              <strong>All {batch.groups.length} items drafted.</strong> Review them on the items page.
            </>
          )}
        </p>
        <progress max={batch.groups.length} value={batch.groups.length - left} style={{ width: "100%" }} />
        {(counts.failed ?? 0) > 0 && (
          <p className="error small">{counts.failed} draft{counts.failed > 1 ? "s" : ""} failed. Open the item to see why and try again.</p>
        )}
      </div>
      <div className="items">
        {batch.groups.map((g, i) => {
          const cover = photos.get(g.photoIds[0]);
          return (
            <Link key={g.itemId} href={`/items/${g.itemId}`} className="itemrow">
              {cover?.thumbUrl ? <img className="thumb" src={cover.thumbUrl} alt="" loading="lazy" /> : <span className="thumb" />}
              <div style={{ minWidth: 0 }}>
                <div className="title">{g.title || `Item ${i + 1}`}</div>
                <div className="muted small">
                  {g.photoIds.length} photo{g.photoIds.length === 1 ? "" : "s"}{g.error && g.status === "failed" ? ` · ${g.error}` : ""}
                </div>
              </div>
              <span className={`pill ${g.status}`}>{STATUS_LABEL[g.status] ?? g.status}</span>
            </Link>
          );
        })}
      </div>
    </>
  );
}
