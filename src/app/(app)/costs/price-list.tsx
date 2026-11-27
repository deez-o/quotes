"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { defaultDensity, type PriceListRead } from "@/lib/site/price-list";
import { importPriceList, readPriceListFile, type ImportLine } from "./price-list-actions";

const MAX_MB = 20;
const UNITS: [string, string][] = [["t", "tonne"], ["m2", "m²"], ["m3", "m³"], ["each", "each"], ["h", "hour"], ["day", "day"], ["km", "km"]];
const KINDS: [string, string][] = [["asphalt", "Asphalt"], ["base", "Base"], ["prime", "Prime"], ["seal", "Seal"], ["other", "Other"]];
const sel: React.CSSProperties = { font: "inherit", padding: 8, borderRadius: 8, border: "1px solid #b5b2ab", background: "#fff" };

type Row = ImportLine & { use: boolean; notes: string | null };

const safeName = (n: string) => n.replace(/[\\/:*?"<>|#%{}^~[\]`]+/g, "_").replace(/\s+/g, " ").trim().slice(0, 100) || "file";

/** Upload a plant's price list (PDF, photo or screenshot), let the AI read it, check the rows, import. */
export function PriceListUpload({ tenantId, plantId, plantName, hasAi }: { tenantId: string; plantId: string; plantName: string; hasAi: boolean }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const camera = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [read, setRead] = useState<PriceListRead | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);

  async function upload(list: FileList | null) {
    const files = Array.from(list ?? []).slice(0, 6);
    if (!files.length) return;
    const big = files.find((f) => f.size > MAX_MB * 1024 * 1024);
    if (big) return setError(`${big.name} is over ${MAX_MB} MB.`);
    setError(null);
    setRead(null);
    setBusy(true);
    try {
      const supabase = createClient();
      const id = crypto.randomUUID();
      const paths: string[] = [];
      for (const [i, f] of files.entries()) {
        setStatus(`Uploading ${i + 1} of ${files.length}...`);
        const path = `${tenantId}/uploads/pricelist-${id}/${i + 1}-${safeName(f.name)}`;
        const { error: e } = await supabase.storage.from("job-files").upload(path, f, { contentType: f.type || "application/octet-stream" });
        if (e) throw new Error(`${f.name}: ${e.message}`);
        paths.push(path);
      }
      setStatus("Reading the prices...");
      const r = await readPriceListFile({ plantId, paths });
      if (!r.ok) throw new Error(r.message);
      setRead(r.read);
      setRows(r.read.lines.map((l, i) => ({
        name: l.name, unit: l.unit === "other" ? "t" : l.unit, rate: l.rate, kind: l.kind,
        density: l.unit === "t" ? defaultDensity(l.kind) : null, existingId: r.matches[i], use: l.unit !== "other", notes: l.notes,
      })));
      setStatus(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed.");
      setStatus(null);
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
      if (camera.current) camera.current.value = "";
    }
  }

  async function save() {
    setBusy(true);
    setError(null);
    const r = await importPriceList({
      plantId, supplier: read?.supplier ?? null, validUntil: read?.valid_until ?? null,
      lines: rows.filter((x) => x.use).map(({ name, unit, rate, kind, density, existingId }) => ({ name, unit, rate: Number(rate), kind, density: density == null ? null : Number(density), existingId })),
    });
    setBusy(false);
    if (!r.ok) return setError(r.message);
    setRead(null);
    setRows([]);
    setStatus(`Imported: ${r.updated} price${r.updated === 1 ? "" : "s"} updated, ${r.added} added.`);
    router.refresh();
  }

  const set = (i: number, patch: Partial<Row>) => setRows((rs) => rs.map((r, n) => (n === i ? { ...r, ...patch } : r)));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: "12px 0", borderTop: "1px solid var(--line-soft)" }}>
      <div className="row" style={{ gap: 8, alignItems: "center" }}>
        <input ref={input} type="file" accept=".pdf,image/*" multiple hidden onChange={(e) => void upload(e.target.files)} />
        <input ref={camera} type="file" accept="image/*" capture="environment" hidden onChange={(e) => void upload(e.target.files)} />
        <button type="button" className="btn" disabled={busy || !hasAi} onClick={() => input.current?.click()}>
          Upload {plantName} price list
        </button>
        <button type="button" className="btn" disabled={busy || !hasAi} onClick={() => camera.current?.click()}>
          Take a photo of it
        </button>
        <span className="sub" style={{ marginTop: 0, fontSize: 13 }}>
          {hasAi ? "A PDF, a screenshot from your photos, or a photo of the printed list. You check every price before it's saved." : "Reading price lists needs the AI switched on. Type the prices in below for now."}
        </span>
      </div>
      {status && <p className="sub" style={{ margin: 0 }} role="status">{status}</p>}
      {error && <p className="error" role="alert" style={{ margin: 0 }}>{error}</p>}

      {read && (
        <div className="card" style={{ background: "var(--paper, #faf9f6)", display: "flex", flexDirection: "column", gap: 8 }}>
          <strong>Check these prices{read.supplier ? ` from ${read.supplier}` : ""}{read.valid_until ? `, valid to ${read.valid_until}` : ""}</strong>
          {read.warnings.map((w, i) => <div key={i} style={{ background: "var(--warn-bg)", padding: "6px 10px", borderRadius: 6, fontSize: 13 }}>{w}</div>)}
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ textAlign: "left" }}>
                  <th style={{ padding: 4 }}>Use</th><th style={{ padding: 4 }}>Name</th><th style={{ padding: 4 }}>Type</th>
                  <th style={{ padding: 4 }}>Price ex GST</th><th style={{ padding: 4 }}>Per</th><th style={{ padding: 4 }}>Density t/m³</th><th style={{ padding: 4 }} />
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} style={{ borderTop: "1px solid var(--line-soft)", opacity: r.use ? 1 : 0.5 }}>
                    <td style={{ padding: 4 }}><input type="checkbox" aria-label={`Import ${r.name}`} checked={r.use} onChange={(e) => set(i, { use: e.target.checked })} /></td>
                    <td style={{ padding: 4, minWidth: 150 }}>
                      <input type="text" value={r.name} onChange={(e) => set(i, { name: e.target.value })} style={{ width: "100%", padding: 8 }} />
                      {r.notes && <div className="sub" style={{ marginTop: 2, fontSize: 12 }}>{r.notes}</div>}
                    </td>
                    <td style={{ padding: 4 }}><select style={sel} value={r.kind} onChange={(e) => set(i, { kind: e.target.value })}>{KINDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></td>
                    <td style={{ padding: 4 }}><input type="text" inputMode="decimal" value={r.rate} onChange={(e) => set(i, { rate: e.target.value as unknown as number })} style={{ width: 90, padding: 8 }} /></td>
                    <td style={{ padding: 4 }}><select style={sel} value={r.unit} onChange={(e) => set(i, { unit: e.target.value })}>{UNITS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></td>
                    <td style={{ padding: 4 }}><input type="text" inputMode="decimal" value={r.density ?? ""} onChange={(e) => set(i, { density: (e.target.value || null) as unknown as number | null })} style={{ width: 70, padding: 8 }} /></td>
                    <td style={{ padding: 4, whiteSpace: "nowrap", fontSize: 12, color: r.existingId ? "var(--ink-2)" : "var(--good)" }}>{r.existingId ? "updates price" : "new"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="row" style={{ gap: 8 }}>
            <button type="button" className="btn primary" disabled={busy || !rows.some((r) => r.use)} onClick={() => void save()}>
              {busy ? "Saving..." : `Import ${rows.filter((r) => r.use).length} price${rows.filter((r) => r.use).length === 1 ? "" : "s"}`}
            </button>
            <button type="button" className="btn" disabled={busy} onClick={() => { setRead(null); setRows([]); }}>Cancel</button>
          </div>
          <p className="sub" style={{ margin: 0, fontSize: 12 }}>Densities for asphalt (2.4) and base (2.2) are typical figures: change them if your supplier gives different ones.</p>
        </div>
      )}
    </div>
  );
}
