"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { BINDERS, binderLabel } from "@/lib/binder";
import { removeBinderExtra, saveBinderExtra, setBaseBinder } from "./actions";

const sel: React.CSSProperties = { font: "inherit", padding: "9px 10px", borderRadius: 8, border: "1px solid #b6bcc4", background: "#fff", minWidth: 0 };

/**
 * At one plant: which binder its mix prices include, and the extra $/t for the others.
 * A job asking for AC14 in C600 is priced as the plant's AC14 + the C600 extra.
 * Each change saves straight away.
 */
export function BinderExtras({ plantId, plantName, base, extras, canEdit }: {
  plantId: string; plantName: string; base: string; extras: { binder: string; extra_per_t: number }[]; canEdit: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [newBinder, setNewBinder] = useState("");
  const [newExtra, setNewExtra] = useState("");

  const run = (fn: () => Promise<{ ok: true } | { ok: false; message: string }>, done?: string, after?: () => void) => start(async () => {
    const r = await fn();
    if (!r.ok) return setMsg({ ok: false, text: r.message });
    setMsg(done ? { ok: true, text: done } : null);
    after?.();
    router.refresh();
  });

  const used = new Set([base, ...extras.map((e) => e.binder)]);
  const choices = BINDERS.filter((b) => !used.has(b.code));
  const add = () => run(() => saveBinderExtra({ plantId, binder: newBinder, extra: newExtra }), `Added ${binderLabel(newBinder)}.`, () => { setNewBinder(""); setNewExtra(""); });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <label style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, fontSize: 14 }}>
        Mix prices at {plantName} include
        <select style={sel} value={base} disabled={!canEdit || pending} onChange={(e) => run(() => setBaseBinder({ plantId, binder: e.target.value }), "Saved.")}>
          {BINDERS.map((b) => <option key={b.code} value={b.code}>{b.label}</option>)}
          {!BINDERS.some((b) => b.code === base) && <option value={base}>{base}</option>}
        </select>
      </label>

      {extras.map((e) => (
        <div key={e.binder} className="row" style={{ gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ flex: "0 1 170px", minWidth: 120, fontWeight: 600, fontSize: 14 }}>{binderLabel(e.binder)}</span>
          <span style={{ fontSize: 14 }}>+ $</span>
          <input type="text" inputMode="decimal" defaultValue={e.extra_per_t} disabled={!canEdit || pending} aria-label={`Extra for ${binderLabel(e.binder)} per tonne`} style={{ width: 90 }}
            onBlur={(x) => { if (x.target.value !== String(e.extra_per_t)) run(() => saveBinderExtra({ plantId, binder: e.binder, extra: x.target.value }), `Saved ${binderLabel(e.binder)}.`); }}
            onKeyDown={(x) => { if (x.key === "Enter") (x.target as HTMLInputElement).blur(); }} />
          <span style={{ fontSize: 14 }}>a tonne</span>
          {canEdit && (
            <button type="button" className="btn" disabled={pending} aria-label={`Remove ${binderLabel(e.binder)}`} style={{ padding: "6px 10px", color: "#9a3412", borderColor: "#f0b8a8", background: "#fdf1ed" }}
              onClick={() => run(() => removeBinderExtra({ plantId, binder: e.binder }), `Removed ${binderLabel(e.binder)}.`)}>✕</button>
          )}
        </div>
      ))}

      {canEdit && (
        <div className="row" style={{ gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <select style={{ ...sel, flex: "0 1 170px" }} value={newBinder} disabled={pending} onChange={(e) => setNewBinder(e.target.value)} aria-label="Binder to add">
            <option value="">Another binder...</option>
            {choices.map((b) => <option key={b.code} value={b.code}>{b.label}</option>)}
          </select>
          <span style={{ fontSize: 14 }}>+ $</span>
          <input type="text" inputMode="decimal" value={newExtra} disabled={pending} onChange={(e) => setNewExtra(e.target.value)} placeholder="0.00" aria-label="Extra per tonne" style={{ width: 90 }}
            onKeyDown={(e) => { if (e.key === "Enter" && newBinder && newExtra) add(); }} />
          <span style={{ fontSize: 14 }}>a tonne</span>
          <button type="button" className="btn primary" disabled={pending || !newBinder || !newExtra.trim()} onClick={add} style={{ padding: "9px 14px" }}>+ Add</button>
        </div>
      )}
      {msg && <span className={msg.ok ? "sub" : "error"} role="status" style={{ marginTop: 0, fontSize: 13, color: msg.ok ? "var(--good)" : undefined }}>{msg.text}</span>}
      {extras.length === 0 && <span className="sub" style={{ marginTop: 0, fontSize: 12 }}>Add the extra $/t this plant charges for other binders. Uploading a price list with binder extra-overs fills these in.</span>}
    </div>
  );
}
