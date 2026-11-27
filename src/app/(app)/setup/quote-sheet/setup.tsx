"use client";

import { useRef, useState, useTransition } from "react";
import { createClient } from "@/lib/supabase/client";
import { SHEET_FIELDS, type SheetFieldId, type SheetMapping } from "@/lib/sheet/map";
import { confirmQuoteSheet, mapQuoteSheet, removeQuoteSheet, updateMapping, type Preview } from "./actions";

const LINE_PARTS = [
  ["description_col", "Description"], ["quantity_col", "Quantity"], ["unit_col", "Unit"], ["rate_col", "Rate"], ["total_col", "Amount"],
] as const;

function safeName(n: string) {
  return n.replace(/[^\w.\- ]+/g, "_").slice(0, 120);
}

export function QuoteSheetSetup({ tenantId, initial, loadError }: { tenantId: string; initial: Preview | null; loadError: string | null }) {
  const [p, setP] = useState<Preview | null>(initial);
  const [draft, setDraft] = useState<SheetMapping | null>(initial?.mapping ?? null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(loadError ? { ok: false, text: loadError } : null);
  const [status, setStatus] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const input = useRef<HTMLInputElement>(null);

  function show(next: Preview) {
    setP(next);
    setDraft(next.mapping);
  }

  async function upload(f: File | undefined) {
    if (!f) return;
    if (!/\.(xlsx|xlsm)$/i.test(f.name)) return setMsg({ ok: false, text: "Use an Excel file (.xlsx or .xlsm). Save older .xls files as .xlsx first." });
    if (f.size > 15 * 1024 * 1024) return setMsg({ ok: false, text: "That file is over 15 MB." });
    setMsg(null);
    setStatus("Uploading...");
    const path = `${tenantId}/uploads/quotesheet-${crypto.randomUUID()}/${safeName(f.name)}`;
    const { error } = await createClient().storage.from("job-files").upload(path, f, { contentType: f.type || "application/octet-stream" });
    if (error) { setStatus(null); return setMsg({ ok: false, text: error.message }); }
    setStatus("Reading your sheet (about 30 seconds)...");
    const r = await mapQuoteSheet({ path, filename: f.name });
    setStatus(null);
    if (!r.ok) return setMsg({ ok: false, text: r.message });
    show(r.preview);
  }

  const fieldCell = (id: SheetFieldId) => draft?.fields.find((f) => f.field === id)?.cell ?? "";
  const setField = (id: SheetFieldId, cell: string) => {
    if (!draft) return;
    const rest = draft.fields.filter((f) => f.field !== id);
    setDraft({ ...draft, fields: cell.trim() ? [...rest, { field: id, cell: cell.trim().toUpperCase() }] : rest });
  };
  const written = new Set(p?.written ?? []);
  const kept = new Set(p?.keptFormulas ?? []);
  const dirty = Boolean(p && draft && JSON.stringify(p.mapping) !== JSON.stringify(draft));

  return (
    <>
      <div className="card row" style={{ gap: 12 }}>
        <span className="grow">{p ? <>Your sheet: <strong>{p.filename}</strong>{p.confirmed ? <span className="badge good" style={{ marginLeft: 8 }}>In use</span> : <span className="badge warn" style={{ marginLeft: 8 }}>Check it below. Until then quotes use the quoteout standard sheet</span>}</> : <>The Excel button gives the <strong>quoteout workings</strong>: every cost with live formulas, plus the customer quote in your branding. <a href="/api/quote-sheet/sample?standard=1" style={{ textDecoration: "underline" }}>Download a sample</a></>}</span>
        <input ref={input} type="file" accept=".xlsx,.xlsm" hidden onChange={(e) => void upload(e.target.files?.[0])} />
        <button type="button" className="btn" disabled={!!status} onClick={() => input.current?.click()}>{p ? "Upload a different sheet" : "Use your own quote sheet instead"}</button>
        {p && (
          <button type="button" className="btn" disabled={pending} onClick={() => start(async () => { const r = await removeQuoteSheet(); if (r.ok) { setP(null); setDraft(null); } })}>Go back to the quoteout workings</button>
        )}
      </div>
      {status && <p className="card" role="status" style={{ margin: 0 }}>{status}</p>}
      {msg && <p role="status" className={msg.ok ? "" : "error"} style={{ margin: 0 }}>{msg.text}</p>}

      {p && draft && (
        <>
          <section className="card" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <h2 style={{ margin: 0 }}>Your sheet with a sample quote in it</h2>
            <p className="sub" style={{ margin: 0, fontSize: 13 }}>
              Cells quoteout fills are <span style={{ background: "#fff1e6", outline: "2px solid var(--brand)", padding: "0 4px" }}>outlined in orange</span>.
              {p.keptFormulas.length > 0 && <> Cells shaded grey keep your own formulas, which work them out.</>}
              {p.notes && <> {p.notes}</>}
            </p>
            <div style={{ overflow: "auto", maxHeight: 520, border: "1px solid var(--line)", borderRadius: 8 }}>
              <table style={{ borderCollapse: "collapse", fontSize: 12, fontVariantNumeric: "tabular-nums" }}>
                <thead>
                  <tr><th style={{ position: "sticky", top: 0, background: "var(--ground)", padding: "4px 6px" }} />{p.grid.cols.map((c) => <th key={c} style={{ position: "sticky", top: 0, background: "var(--ground)", padding: "4px 6px", fontWeight: 600, color: "var(--muted)" }}>{c}</th>)}</tr>
                </thead>
                <tbody>
                  {p.grid.rows.map((row, r) => (
                    <tr key={r}>
                      <td style={{ background: "var(--ground)", color: "var(--muted)", padding: "4px 6px", textAlign: "right" }}>{r + 1}</td>
                      {row.map((v, c) => {
                        const ref = `${p.grid.cols[c]}${r + 1}`;
                        const hit = written.has(ref), keep = kept.has(ref);
                        return (
                          <td key={c} title={ref} style={{ border: "1px solid var(--line-soft)", padding: "4px 6px", maxWidth: 220, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                            ...(hit && !keep ? { background: "#fff1e6", outline: "2px solid var(--brand)", outlineOffset: -2 } : {}), ...(keep ? { background: "#eceef1" } : {}) }}>{v}</td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="card" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <h2 style={{ margin: 0 }}>Where things go</h2>
            <p className="sub" style={{ margin: 0, fontSize: 13 }}>Change a cell if it&apos;s in the wrong place, or clear it to leave that out. Then press Update preview.</p>
            {p.sheets.length > 1 && (
              <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 14 }}>Sheet
                <select value={draft.sheet} onChange={(e) => setDraft({ ...draft, sheet: e.target.value })} style={{ font: "inherit", border: "1px solid #b6bcc4", borderRadius: 8, padding: 8, background: "#fff" }}>
                  {p.sheets.map((s) => <option key={s}>{s}</option>)}
                </select>
              </label>
            )}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))", gap: 8 }}>
              {SHEET_FIELDS.map((f) => (
                <label key={f.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, fontSize: 14, fontWeight: 400 }}>
                  {f.label}
                  <input type="text" value={fieldCell(f.id)} onChange={(e) => setField(f.id, e.target.value)} placeholder="–" style={{ width: 70, padding: 6, textAlign: "center" }} />
                </label>
              ))}
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", fontSize: 14 }}>
              <strong>Quote lines:</strong> rows
              <input type="text" inputMode="numeric" value={draft.lines.first_row} onChange={(e) => setDraft({ ...draft, lines: { ...draft.lines, first_row: Number(e.target.value) || 0 } })} style={{ width: 60, padding: 6 }} /> to
              <input type="text" inputMode="numeric" value={draft.lines.last_row} onChange={(e) => setDraft({ ...draft, lines: { ...draft.lines, last_row: Number(e.target.value) || 0 } })} style={{ width: 60, padding: 6 }} />
              {LINE_PARTS.map(([k, label]) => (
                <label key={k} style={{ display: "flex", gap: 4, alignItems: "center", fontWeight: 400 }}>{label}
                  <input type="text" value={draft.lines[k]} onChange={(e) => setDraft({ ...draft, lines: { ...draft.lines, [k]: e.target.value.toUpperCase() } })} placeholder="–" style={{ width: 44, padding: 6, textAlign: "center" }} />
                </label>
              ))}
            </div>
            <div className="row" style={{ gap: 10 }}>
              <button type="button" className="btn" disabled={pending || !dirty} onClick={() => start(async () => {
                const r = await updateMapping(draft);
                if (r.ok) { show(r.preview); setMsg(null); } else setMsg({ ok: false, text: r.message });
              })}>Update preview</button>
              <button type="button" className="btn primary" disabled={pending || dirty || p.confirmed} onClick={() => start(async () => {
                const r = await confirmQuoteSheet();
                if (r.ok) { setP({ ...p, confirmed: true }); setMsg({ ok: true, text: "Done. Every quote now has an Excel button that downloads it in your sheet." }); } else setMsg({ ok: false, text: r.message });
              })}>{p.confirmed ? "In use" : "That looks right"}</button>
              <a className="btn" href="/api/quote-sheet/sample">Download the sample</a>
            </div>
          </section>
        </>
      )}
    </>
  );
}
