"use client";

import { useState } from "react";

type F = { name: string; url: string | null };

/** On a desktop, the RFQ's drawings shown right on the quote (tabs per file). Phones keep the links. */
export function PlanViewer({ files }: { files: F[] }) {
  const viewable = files.filter((f) => f.url && /\.(pdf|png|jpe?g|webp|gif)$/i.test(f.name));
  const first = viewable.find((f) => /plan|drawing|layout|civil|site|dwg|c\d{2,}/i.test(f.name) && /\.pdf$/i.test(f.name))
    ?? viewable.find((f) => /\.pdf$/i.test(f.name)) ?? viewable[0];
  const [open, setOpen] = useState(first?.name ?? "");
  if (!viewable.length) return null;
  const cur = viewable.find((f) => f.name === open) ?? first!;
  return (
    <div className="plan-viewer" style={{ flexDirection: "column", gap: 8 }}>
      {viewable.length > 1 && (
        <div className="row" style={{ gap: 6, flexWrap: "wrap" }} role="tablist" aria-label="Drawings">
          {viewable.map((f) => (
            <button key={f.name} type="button" role="tab" aria-selected={f.name === cur.name} onClick={() => setOpen(f.name)}
              className="btn" style={{ padding: "5px 10px", fontSize: 13, ...(f.name === cur.name ? { background: "var(--ink)", color: "#fff", borderColor: "var(--ink)" } : {}) }}>
              {f.name.length > 40 ? `${f.name.slice(0, 37)}...` : f.name}
            </button>
          ))}
        </div>
      )}
      {/\.pdf$/i.test(cur.name)
        ? <iframe key={cur.url} src={`${cur.url}#view=FitH`} title={cur.name} style={{ width: "100%", height: "75vh", border: "1px solid var(--line)", borderRadius: 8, background: "#fff" }} />
        // eslint-disable-next-line @next/next/no-img-element -- signed storage URL
        : <img src={cur.url!} alt={cur.name} style={{ width: "100%", maxHeight: "75vh", objectFit: "contain", border: "1px solid var(--line)", borderRadius: 8, background: "#fff" }} />}
    </div>
  );
}
