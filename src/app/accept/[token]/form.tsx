"use client";

import { useActionState, useState } from "react";
import { acceptQuote, type AcceptState } from "./actions";

export function AcceptForm({ token, options, brand, onBrand }: { token: string; options: { id: string; label: string | null; title: string; total: string }[]; brand: string; onBrand: string }) {
  const [state, action, pending] = useActionState<AcceptState, FormData>(acceptQuote, null);
  const [pick, setPick] = useState(options.length === 1 ? options[0].id : "");
  if (state?.ok) {
    return (
      <div style={{ padding: 20, borderRadius: 10, background: "#ecfdf3", border: "1px solid #abefc6" }}>
        <strong style={{ fontSize: 18 }}>Thanks, the quote is accepted.</strong>
        <p style={{ margin: "6px 0 0" }}>We&apos;ve let them know. They&apos;ll be in touch to book the work in.</p>
      </div>
    );
  }
  const field: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 4, fontWeight: 600, fontSize: 14 };
  const input: React.CSSProperties = { font: "inherit", padding: "10px 12px", borderRadius: 8, border: "1px solid #b6bcc4", fontWeight: 400 };
  return (
    <form action={action} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <input type="hidden" name="token" value={token} />
      <input type="text" name="website" tabIndex={-1} autoComplete="off" aria-hidden style={{ position: "absolute", left: -9999 }} />
      {options.length > 1 && (
        <fieldset style={{ border: 0, padding: 0, margin: 0, display: "grid", gap: 8 }}>
          <legend style={{ fontWeight: 600, fontSize: 14, marginBottom: 6 }}>Which option would you like?</legend>
          {options.map((o) => (
            <label key={o.id} style={{ display: "flex", gap: 10, alignItems: "center", padding: "10px 12px", borderRadius: 8, border: `2px solid ${pick === o.id ? brand : "#e1e4e8"}`, cursor: "pointer" }}>
              <input type="radio" name="option" value={o.id} checked={pick === o.id} onChange={() => setPick(o.id)} required />
              <span style={{ flex: 1 }}><strong>Option {o.label}</strong> {o.title}</span>
              <strong>{o.total}</strong>
            </label>
          ))}
        </fieldset>
      )}
      {options.length === 1 && <input type="hidden" name="option" value={options[0].id} />}
      <label style={field}>Your name<input name="name" required autoComplete="name" style={input} /></label>
      <label style={field}>Purchase order number <span style={{ fontWeight: 400, color: "#5b6168" }}>(if you have one)</span><input name="po" style={input} /></label>
      <label style={field}>Anything we should know? <span style={{ fontWeight: 400, color: "#5b6168" }}>(optional)</span><textarea name="note" rows={3} style={input} placeholder="e.g. best start date, site contact" /></label>
      <label style={{ display: "flex", gap: 10, alignItems: "flex-start", fontSize: 14 }}>
        <input type="checkbox" name="agree" required style={{ marginTop: 3 }} /> I accept this quote and its terms, and I&apos;m authorised to do so.
      </label>
      {state && !state.ok && <p role="alert" style={{ color: "#b42318", margin: 0 }}>{state.message}</p>}
      <button type="submit" disabled={pending || (options.length > 1 && !pick)}
        style={{ font: "inherit", fontWeight: 700, fontSize: 16, padding: "14px 20px", borderRadius: 8, border: 0, background: brand, color: onBrand, cursor: "pointer" }}>
        {pending ? "Accepting..." : "Accept quote"}
      </button>
    </form>
  );
}
