"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/client-api";

// Uploads a batch one photo per request, 3 at a time, retrying failures.
// Re-sending a file is harmless (the server skips files it already has), so
// "Try again" after a dropped connection only sends what's missing.

const PARALLEL = 3;
const RETRIES = 3;

const isImage = (f: File) => f.type.startsWith("image/") || /\.(hei[cf]|jpe?g|png|webp)$/i.test(f.name);

export function BatchUploader({ uploadId: existingId, startOrder = 0 }: { uploadId?: string; startOrder?: number }) {
  const router = useRouter();
  const pick = useRef<HTMLInputElement>(null);
  const folder = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [drag, setDrag] = useState(false);
  const [phase, setPhase] = useState<"pick" | "uploading" | "grouping">("pick");
  const [done, setDone] = useState(0);
  const [failed, setFailed] = useState<{ file: File; error: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [total, setTotal] = useState(0);
  const uploadId = useRef<string | null>(existingId ?? null);

  function add(list: FileList | null) {
    if (!list) return;
    const incoming = [...list].filter(isImage);
    setFiles((prev) => {
      const keys = new Set(prev.map((f) => `${f.name}|${f.size}`));
      return [...prev, ...incoming.filter((f) => !keys.has(`${f.name}|${f.size}`))];
    });
  }

  async function sendOne(file: File, order: number) {
    const form = new FormData();
    form.append("photo", file);
    form.append("pickOrder", String(order));
    form.append("lastModified", String(file.lastModified));
    form.append("tzOffset", String(new Date(file.lastModified || Date.now()).getTimezoneOffset()));
    let last: unknown;
    for (let attempt = 0; attempt < RETRIES; attempt++) {
      try {
        await api(`/api/uploads/${uploadId.current}/photos`, { method: "POST", body: form });
        return;
      } catch (e) {
        last = e;
        await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
      }
    }
    throw last;
  }

  async function start(list: File[]) {
    setError(null);
    setFailed([]);
    setPhase("uploading");
    setDone(0);
    setTotal(list.length);
    try {
      if (!uploadId.current) uploadId.current = (await api<{ id: string }>("/api/uploads", { method: "POST" })).id;
    } catch (e) {
      setError((e as Error).message);
      setPhase("pick");
      return;
    }

    const queue = list.map((file) => ({ file, order: startOrder + files.indexOf(file) }));
    const misses: { file: File; error: string }[] = [];
    let next = 0;
    await Promise.all(
      Array.from({ length: PARALLEL }, async () => {
        while (next < queue.length) {
          const { file, order } = queue[next++];
          try {
            await sendOne(file, order);
          } catch (e) {
            misses.push({ file, error: (e as Error).message });
          }
          setDone((d) => d + 1);
        }
      }),
    );

    if (misses.length) {
      setFailed(misses);
      setPhase("pick");
      return;
    }
    setPhase("grouping");
    try {
      await api(`/api/uploads/${uploadId.current}/group`, { method: "POST" });
    } catch (e) {
      // The batch page shows the problem and a button to try grouping again.
      void e;
    }
    router.push(`/uploads/${uploadId.current}`);
    router.refresh();
  }


  return (
    <div className="panel">
      {phase === "pick" && (
        <>
          <label
            className={`dropzone${drag ? " drag" : ""}`}
            htmlFor="batch-photos"
            onDragOver={(e) => {
              e.preventDefault();
              setDrag(true);
            }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDrag(false);
              add(e.dataTransfer.files);
            }}
          >
            <strong>Choose photos</strong>
            <span className="muted small">Any number, any order: the app sorts them by when they were taken.</span>
          </label>
          <input
            ref={pick}
            id="batch-photos"
            type="file"
            accept="image/*,.heic,.heif"
            multiple
            hidden
            onChange={(e) => {
              add(e.target.files);
              e.target.value = "";
            }}
          />
          <input
            ref={folder}
            type="file"
            hidden
            multiple
            // Folder picking: supported by desktop browsers.
            {...({ webkitdirectory: "", directory: "" } as Record<string, string>)}
            onChange={(e) => {
              add(e.target.files);
              e.target.value = "";
            }}
          />
          <div className="row">
            <button className="btn" type="button" onClick={() => folder.current?.click()}>
              Choose a folder (computer)
            </button>
            {files.length > 0 && <span className="muted small">{files.length} photos chosen</span>}
          </div>
          {failed.length > 0 && (
            <div className="error">
              {failed.length} of {files.length} photos didn&apos;t upload ({failed[0].error}). Check your connection and try again; photos
              already uploaded aren&apos;t sent twice.
            </div>
          )}
          {error && <p className="error">{error}</p>}
          {files.length > 0 && (
            <div className="row">
              <button className="btn primary" onClick={() => start(failed.length ? failed.map((f) => f.file) : files)}>
                {failed.length ? `Try the ${failed.length} again` : `Upload ${files.length} photos`}
              </button>
              {!failed.length && (
                <button className="btn" onClick={() => setFiles([])}>
                  Clear
                </button>
              )}
            </div>
          )}
        </>
      )}
      {phase === "uploading" && (
        <div style={{ display: "grid", gap: 8 }}>
          <strong>
            Uploading {Math.min(done, total)} of {total}…
          </strong>
          <progress max={total} value={done} style={{ width: "100%" }} />
          <p className="muted small">Keep this page open until it finishes. On a phone, keep the screen on.</p>
        </div>
      )}
      {phase === "grouping" && (
        <div style={{ display: "grid", gap: 8 }}>
          <strong>Sorting photos into items…</strong>
          <p className="muted small">Finding divider cards, then Claude checks any group it isn&apos;t sure about. Usually under a minute.</p>
        </div>
      )}
    </div>
  );
}
