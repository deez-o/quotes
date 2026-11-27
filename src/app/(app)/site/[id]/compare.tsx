"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { applyTrialVersion } from "../compare-actions";

export type CompareView = {
  current: { label: string; total: number | null; questions: number; items: number };
  others: { id: string; label: string; total: number | null; questions: number; items: { description: string; size: string }[]; asks: string[]; assumes: string[]; seconds: number; costUsd: number | null; error: string | null }[];
};

const money = (n: number | null) => (n == null ? "–" : `$${Math.round(n).toLocaleString("en-AU")}`);

/** Testing only (quoteout staff): the same RFQ drafted by other models, side by side with this quote. */
export function ComparePanel({ quoteId, view }: { quoteId: string; view: CompareView }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const router = useRouter();

  return (
    <details className="card" open style={{ borderColor: "var(--brand)" }}>
      <summary style={{ fontWeight: 600, cursor: "pointer", fontSize: 18 }}>Compare models <span className="badge warn" style={{ marginLeft: 6, fontSize: 11 }}>only you see this</span></summary>
      <p className="sub" style={{ marginTop: 6, fontSize: 13 }}>
        This quote: <strong>{view.current.label}</strong>, {money(view.current.total)} ex GST, {view.current.items} items, {view.current.questions} questions.
        &ldquo;Use this version&rdquo; swaps in that model&apos;s items, crew and questions; the site, customer and margin stay.
      </p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 10, marginTop: 8 }}>
        {view.others.map((o) => (
          <div key={o.id} style={{ border: "1px solid var(--line)", borderRadius: 10, padding: 12, display: "flex", flexDirection: "column", gap: 8, fontSize: 13 }}>
            <div><strong style={{ fontSize: 15 }}>{o.label}</strong><span className="sub" style={{ fontSize: 12 }}> · {o.seconds}s{o.costUsd != null ? ` · US$${o.costUsd.toFixed(3)}` : ""}</span></div>
            {o.error ? <span className="error">{o.error}</span> : (
              <>
                <div style={{ fontSize: 20, fontWeight: 700 }}>{money(o.total)}<span className="sub" style={{ fontSize: 12 }}> ex GST</span></div>
                <ul style={{ margin: 0, paddingLeft: 16 }}>{o.items.map((it, i) => <li key={i}>{it.description}{it.size ? ` (${it.size})` : ""}</li>)}</ul>
                {o.asks.length > 0 && <div style={{ background: "var(--warn-bg)", borderRadius: 6, padding: 6 }}><strong>Asks:</strong> {o.asks.join(" · ")}</div>}
                {o.assumes.length > 0 && <div><strong>Assumes:</strong> {o.assumes.join(" · ")}</div>}
                <button type="button" className="btn" disabled={pending} style={{ padding: "6px 10px", fontSize: 13 }}
                  onClick={() => {
                    if (confirm !== o.id) { setConfirm(o.id); return; }
                    setConfirm(null);
                    start(async () => { const r = await applyTrialVersion({ quoteId, trialId: o.id }); setMsg(r.message); if (r.ok) router.refresh(); });
                  }}>
                  {confirm === o.id ? "Tap again: replaces this quote's items" : "Use this version"}
                </button>
              </>
            )}
          </div>
        ))}
      </div>
      {msg && <p role="status" style={{ margin: "8px 0 0", fontWeight: 600 }}>{msg}</p>}
    </details>
  );
}
