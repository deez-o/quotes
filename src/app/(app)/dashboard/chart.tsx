"use client";

import { useState } from "react";

const QUOTED = "#257de0";
const WON = "#f47230";
const money = (n: number) => `$${Math.round(n).toLocaleString("en-AU")}`;
const short = (n: number) => (n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(1)}m` : n >= 1000 ? `$${Math.round(n / 1000)}k` : `$${Math.round(n)}`);

/** Grouped bars by month: quoted and won (same units, one axis). Hover or tap a month for its numbers. */
export function MonthChart({ months }: { months: { key: string; label: string; quoted: number; won: number; count: number }[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...months.map((m) => m.quoted));
  const nice = (() => { const p = 10 ** Math.floor(Math.log10(max)); const s = [1, 2, 2.5, 5, 10].map((k) => k * p).find((v) => v * 4 >= max) ?? max; return s * 4; })();
  const H = 200;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * nice);
  const h = hover == null ? null : months[hover];
  return (
    <div>
      <div className="row" style={{ gap: 16, fontSize: 13, marginBottom: 8 }} aria-hidden>
        <span className="row" style={{ gap: 6, alignItems: "center" }}><span style={{ width: 10, height: 10, borderRadius: 2, background: QUOTED }} />Quoted</span>
        <span className="row" style={{ gap: 6, alignItems: "center" }}><span style={{ width: 10, height: 10, borderRadius: 2, background: WON }} />Won</span>
        <span className="grow" />
        <span className="sub" style={{ marginTop: 0, minHeight: 18 }}>{h ? `${h.label}: ${money(h.quoted)} quoted (${h.count}), ${money(h.won)} won` : "Hover or tap a month"}</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "44px 1fr", gap: 6 }}>
        <div style={{ position: "relative", height: H }} aria-hidden>
          {ticks.map((t) => <span key={t} style={{ position: "absolute", right: 0, bottom: (t / nice) * H - 7, fontSize: 11, color: "var(--muted)" }}>{short(t)}</span>)}
        </div>
        <div style={{ position: "relative", height: H, display: "grid", gridTemplateColumns: `repeat(${months.length}, 1fr)`, alignItems: "end" }} role="img"
          aria-label={`Quoted and won by month: ${months.map((m) => `${m.label} ${money(m.quoted)} quoted, ${money(m.won)} won`).join("; ")}`}>
          {ticks.map((t) => <div key={t} style={{ position: "absolute", left: 0, right: 0, bottom: (t / nice) * H, borderTop: `1px solid ${t ? "var(--line-soft)" : "#b6bcc4"}` }} />)}
          {months.map((m, i) => (
            <div key={m.key} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} onClick={() => setHover(i)}
              style={{ position: "relative", height: "100%", display: "flex", alignItems: "flex-end", justifyContent: "center", gap: 2, background: hover === i ? "rgba(0,0,0,.04)" : undefined, cursor: "default" }}>
              <div style={{ width: "34%", maxWidth: 16, height: (m.quoted / nice) * H, background: QUOTED, borderRadius: "4px 4px 0 0" }} />
              <div style={{ width: "34%", maxWidth: 16, height: (m.won / nice) * H, background: WON, borderRadius: "4px 4px 0 0" }} />
            </div>
          ))}
        </div>
        <span />
        <div style={{ display: "grid", gridTemplateColumns: `repeat(${months.length}, 1fr)`, fontSize: 11, color: "var(--muted)", textAlign: "center" }}>
          {months.map((m) => <span key={m.key}>{m.label}</span>)}
        </div>
      </div>
      <details style={{ marginTop: 10 }}>
        <summary className="sub" style={{ cursor: "pointer" }}>Show as a table</summary>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, marginTop: 6 }}>
          <thead><tr style={{ textAlign: "left" }}><th>Month</th><th style={{ textAlign: "right" }}>Quotes</th><th style={{ textAlign: "right" }}>Quoted</th><th style={{ textAlign: "right" }}>Won</th></tr></thead>
          <tbody>{months.map((m) => <tr key={m.key}><td>{m.label}</td><td style={{ textAlign: "right" }}>{m.count}</td><td style={{ textAlign: "right" }}>{money(m.quoted)}</td><td style={{ textAlign: "right" }}>{money(m.won)}</td></tr>)}</tbody>
        </table>
      </details>
    </div>
  );
}
