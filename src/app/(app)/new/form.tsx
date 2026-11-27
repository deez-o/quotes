"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { queueUpload } from "./actions";

const ACCEPT = ".eml,.msg,.pdf,.xlsx,.xlsm,.xls,.csv,.docx,.doc,.png,.jpg,.jpeg,.webp,.txt";
const MAX_FILE_MB = 50;

function safeName(name: string) {
  return name.replace(/[\\/:*?"<>|#%{}^~[\]`]+/g, "_").replace(/\s+/g, " ").trim().slice(0, 120) || "file";
}

export function NewQuoteForm({ tenantId, canSend }: { tenantId: string; canSend: boolean }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [text, setText] = useState("");
  const [dragging, setDragging] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function add(list: FileList | null) {
    if (!list) return;
    const incoming = Array.from(list);
    const tooBig = incoming.filter((f) => f.size > MAX_FILE_MB * 1024 * 1024);
    if (tooBig.length) setError(`${tooBig.map((f) => f.name).join(", ")} is over ${MAX_FILE_MB} MB.`);
    setFiles((prev) => {
      const names = new Set(prev.map((f) => f.name));
      return [...prev, ...incoming.filter((f) => f.size <= MAX_FILE_MB * 1024 * 1024 && !names.has(f.name))];
    });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (files.length === 0 && text.trim().length < 10) {
      setError("Add the RFQ email or files, or paste the email text.");
      return;
    }
    setBusy(true);
    const uploadId = crypto.randomUUID();
    const supabase = createClient();
    const paths: string[] = [];
    try {
      for (const [i, f] of files.entries()) {
        setStatus(`Uploading ${i + 1} of ${files.length}: ${f.name}`);
        const path = `${tenantId}/uploads/${uploadId}/${safeName(f.name)}`;
        const { error: upErr } = await supabase.storage.from("job-files").upload(path, f, {
          contentType: f.type || "application/octet-stream",
          upsert: false,
        });
        if (upErr) throw new Error(`${f.name}: ${upErr.message}`);
        paths.push(path);
      }
      setStatus("Sending to quoteout...");
      const result = await queueUpload({ uploadId, paths, pastedText: text });
      if (!result.ok) throw new Error(result.message);
      router.push("/quotes?show=rfq&sent=1");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed.");
      setStatus(null);
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div
        role="button"
        tabIndex={0}
        aria-label="Add the RFQ email and files"
        onClick={() => input.current?.click()}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); input.current?.click(); } }}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); add(e.dataTransfer.files); }}
        className="card"
        style={{
          borderStyle: "dashed", borderWidth: 2, borderColor: dragging ? "var(--accent)" : "#b5b2ab",
          background: dragging ? "#fdf4ee" : "var(--card)", textAlign: "center", padding: "36px 20px", cursor: "pointer",
        }}
      >
        <div style={{ fontWeight: 600, fontSize: 16 }}>Drag the RFQ email here, with any drawings or BoQ</div>
        <div className="sub">Drop the saved email (.msg or .eml; in Outlook you can drag it to your desktop first) plus any PDF, Excel, Word or picture files. Or click to choose files.</div>
        <input ref={input} type="file" multiple accept={ACCEPT} hidden onChange={(e) => { add(e.target.files); e.target.value = ""; }} />
      </div>

      {files.length > 0 && (
        <ul className="card" style={{ listStyle: "none", margin: 0, padding: "8px 20px" }}>
          {files.map((f) => (
            <li key={f.name} className="row" style={{ padding: "8px 0", borderBottom: "1px solid var(--line-soft)", gap: 12 }}>
              <span className="grow">{f.name}</span>
              <span className="sub" style={{ marginTop: 0 }}>{(f.size / 1024 / 1024).toFixed(1)} MB</span>
              <button type="button" className="btn" style={{ padding: "6px 10px" }} disabled={busy}
                onClick={() => setFiles((prev) => prev.filter((x) => x !== f))} aria-label={`Remove ${f.name}`}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <label htmlFor="pasted">Or paste the email text <span style={{ fontWeight: 400, color: "var(--muted)" }}>(and any note for this quote)</span></label>
        <textarea id="pasted" rows={6} value={text} onChange={(e) => setText(e.target.value)}
          placeholder={"From: Sam Turner <sam@customer.com.au>\nSubject: RFQ - Carpark resurfacing\n\nHi, please quote..."} />
      </div>

      {error && <p className="error" role="alert">{error}</p>}
      <div className="row" style={{ gap: 12 }}>
        <button type="submit" className="btn primary" disabled={busy || !canSend}>{busy ? "Sending..." : "Quote this"}</button>
        {status && <span className="sub" style={{ marginTop: 0 }} aria-live="polite">{status}</span>}
        {!canSend && <span className="sub" style={{ marginTop: 0 }}>Viewers can&apos;t send in RFQs.</span>}
      </div>
    </form>
  );
}
