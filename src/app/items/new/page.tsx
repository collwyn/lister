"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

const MAX = 24;

export default function NewItemPage() {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const previews = useMemo(() => files.map((f) => URL.createObjectURL(f)), [files]);
  useEffect(() => () => previews.forEach((u) => URL.revokeObjectURL(u)), [previews]);

  function add(list: FileList | null) {
    if (!list) return;
    const images = [...list].filter((f) => f.type.startsWith("image/") || /\.hei[cf]$/i.test(f.name));
    setFiles((prev) => [...prev, ...images].slice(0, MAX));
  }

  async function upload() {
    setBusy(true);
    setError(null);
    const form = new FormData();
    files.forEach((f) => form.append("photos", f));
    const res = await fetch("/api/items", { method: "POST", body: form });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(json.error ?? "Upload failed.");
      setBusy(false);
      return;
    }
    router.push(`/items/${json.id}?draft=1`);
  }

  return (
    <main className="wrap">
      <h1>New item</h1>
      <div className="panel">
        <p className="muted">
          Add up to {MAX} photos of <strong>one</strong> item. Put the best overall shot first; include labels, model numbers and any flaws.
        </p>
        <label
          className={`dropzone${drag ? " drag" : ""}`}
          htmlFor="photos"
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
          <span className="muted small">or drag them here · JPEG, PNG, WebP or iPhone HEIC</span>
        </label>
        <input
          ref={input}
          id="photos"
          type="file"
          accept="image/*,.heic,.heif"
          multiple
          hidden
          onChange={(e) => {
            add(e.target.files);
            e.target.value = "";
          }}
        />
        {files.length > 0 && (
          <>
            <div className="previews">
              {files.map((f, i) => (
                <img key={i} src={previews[i]} alt={f.name} title={f.name} />
              ))}
            </div>
            <div className="row">
              <button className="btn primary" onClick={upload} disabled={busy}>
                {busy ? `Uploading ${files.length} photo${files.length > 1 ? "s" : ""}…` : `Upload ${files.length} photo${files.length > 1 ? "s" : ""}`}
              </button>
              <button className="btn" onClick={() => setFiles([])} disabled={busy}>
                Clear
              </button>
            </div>
          </>
        )}
        {error && <p className="error">{error}</p>}
      </div>
    </main>
  );
}
