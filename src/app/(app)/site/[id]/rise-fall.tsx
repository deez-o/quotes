"use client";

import { useState } from "react";
import { indexFor, monthName, riseAndFall, type BitumenIndex } from "@/lib/bitumen";

const money = (n: number) => `${n < 0 ? "-" : ""}$${Math.abs(n).toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** What the bitumen rise and fall comes to if the job is laid this month, against the month it was priced. */
export function RiseAndFall({ tonnes, indexes, binderPercent, quotedAt }: { tonnes: number; indexes: BitumenIndex[]; binderPercent: number; quotedAt: string }) {
  const sorted = [...indexes].sort((a, b) => b.month.localeCompare(a.month));
  const [base, setBase] = useState(indexFor(sorted, quotedAt)?.month ?? sorted[sorted.length - 1]?.month ?? "");
  const [now, setNow] = useState(sorted[0]?.month ?? "");
  const [pct, setPct] = useState(String(binderPercent));
  if (!sorted.length) return <p className="sub" style={{ margin: 0 }}>The bitumen index hasn&apos;t been loaded yet.</p>;
  const b = sorted.find((x) => x.month === base);
  const c = sorted.find((x) => x.month === now);
  const p = Number(pct);
  const r = b && c && Number.isFinite(p) && p > 0 && p < 20 ? riseAndFall({ asphaltTonnes: tonnes, binderPercent: p, baseIndex: b.value, currentIndex: c.value }) : null;
  const small: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 4, fontSize: 12, fontWeight: 600 };
  const opts = sorted.map((x) => <option key={x.month} value={x.month}>{monthName(x.month)} (${x.value.toLocaleString("en-AU")})</option>);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 8 }}>
        <label style={small}>Priced in<select value={base} onChange={(e) => setBase(e.target.value)}>{opts}</select></label>
        <label style={small}>Laid in<select value={now} onChange={(e) => setNow(e.target.value)}>{opts}</select></label>
        <label style={small}>Binder in the mix (%)<input type="text" inputMode="decimal" value={pct} onChange={(e) => setPct(e.target.value)} /></label>
      </div>
      {r && (
        <div>
          <div>{tonnes.toLocaleString("en-AU", { maximumFractionDigits: 1 })} t asphalt × {p}% = {r.binderTonnes.toLocaleString("en-AU")} t binder × {money(r.change)}/t change</div>
          <div style={{ fontSize: 20, fontWeight: 700, marginTop: 4 }}>{r.amount === 0 ? "No change" : `${r.amount > 0 ? "Rise" : "Fall"} of ${money(Math.abs(r.amount))} ex GST`}</div>
        </div>
      )}
      <p className="sub" style={{ margin: 0 }}>From TMR&apos;s monthly bitumen price index. Only claim it where your terms or the contract allow rise and fall.</p>
    </div>
  );
}
