"use client";

import { useEffect, useRef, useState } from "react";
import { parseAddresses } from "@/lib/quote/email";
import { sendDraft, sendQuote } from "./send-actions";

type Draft = Extract<Awaited<ReturnType<typeof sendDraft>>, { ok: true }>;

/** Email the quote PDF to the customer, from inside the app. Nothing goes until Send is pressed. */
export function SendQuoteDialog({ quoteId, onClose, onSent }: { quoteId: string; onClose: () => void; onSent: (to: string[]) => void }) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [to, setTo] = useState("");
  const [cc, setCc] = useState("");
  const [showCc, setShowCc] = useState(false);
  const [copyMe, setCopyMe] = useState(true);
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);

  const closeRef = useRef(onClose);
  const busyRef = useRef(busy);
  useEffect(() => { closeRef.current = onClose; busyRef.current = busy; });

  useEffect(() => {
    let live = true;
    sendDraft({ id: quoteId }).then((d) => {
      if (!live) return;
      if (!d.ok) return setErr(d.message);
      setDraft(d); setTo(d.to); setSubject(d.subject); setMessage(d.message);
    });
    return () => { live = false; };
  }, [quoteId]);

  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape" && !busyRef.current) closeRef.current(); };
    window.addEventListener("keydown", esc);
    box.current?.focus();
    return () => window.removeEventListener("keydown", esc);
  }, []);

  const toList = parseAddresses(to);
  const ccList = parseAddresses(cc, 5);

  async function send() {
    setBusy(true); setErr(null);
    const r = await sendQuote({ id: quoteId, to, cc, subject, message, copyMe });
    setBusy(false);
    if (!r.ok) return setErr(r.message);
    onSent(r.sentTo);
  }

  const lbl: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 4, fontSize: 13, fontWeight: 600 };
  return (
    <div role="presentation" onClick={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}
      style={{ position: "fixed", inset: 0, background: "rgba(16,18,20,.45)", zIndex: 60, display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "4vh 12px", overflowY: "auto" }}>
      <div ref={box} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="send-title" className="card"
        style={{ width: "min(620px, 100%)", display: "flex", flexDirection: "column", gap: 12, outline: "none" }}>
        <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
          <h2 id="send-title" style={{ margin: 0 }}>Send to customer</h2>
          <button type="button" className="btn" onClick={onClose} disabled={busy} aria-label="Close">✕</button>
        </div>

        {!draft && !err && <p className="sub">Getting the email ready...</p>}
        {draft && !draft.canSend && (
          <p style={{ margin: 0, padding: 10, borderRadius: 8, background: "var(--warn-bg)" }}>Sending email isn&apos;t switched on yet. For now, use PDF / print and attach it to your own email.</p>
        )}

        {draft && (
          <>
            <label style={lbl}>To
              <input type="text" inputMode="email" autoComplete="off" value={to} onChange={(e) => setTo(e.target.value)} placeholder="customer@example.com.au, another@example.com.au" />
              <span className="sub" style={{ fontWeight: 400, marginTop: 0 }}>
                {toList.invalid.length ? <span className="error">Check: {toList.invalid.join(", ")}</span>
                  : toList.valid.length ? `${toList.valid.length} ${toList.valid.length === 1 ? "person" : "people"}. Separate more with a comma.` : "Separate more than one with a comma."}
              </span>
            </label>
            {showCc ? (
              <label style={lbl}>Cc
                <input type="text" inputMode="email" autoComplete="off" value={cc} onChange={(e) => setCc(e.target.value)} />
                {ccList.invalid.length > 0 && <span className="error" style={{ fontWeight: 400 }}>Check: {ccList.invalid.join(", ")}</span>}
              </label>
            ) : (
              <button type="button" className="sub" onClick={() => setShowCc(true)} style={{ alignSelf: "flex-start", background: "none", border: 0, padding: 0, cursor: "pointer", textDecoration: "underline", font: "inherit", fontSize: 13 }}>Add Cc</button>
            )}
            <label style={lbl}>Subject<input type="text" value={subject} onChange={(e) => setSubject(e.target.value)} /></label>
            <label style={lbl}>Message<textarea rows={11} value={message} onChange={(e) => setMessage(e.target.value)} /></label>
            <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 14 }}>
              <input type="checkbox" checked={copyMe} onChange={(e) => setCopyMe(e.target.checked)} /> Send me a copy
            </label>
            <div className="row" style={{ gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <span aria-hidden>📎</span>
              <a href={`/api/quotes/${quoteId}/pdf`} target="_blank" rel="noreferrer">The quote PDF</a>
              <span className="sub" style={{ marginTop: 0 }}>is attached. Open it to check.</span>
            </div>
            {draft.history.length > 0 && (
              <div className="sub" style={{ marginTop: 0 }}>
                Sent before: {draft.history.map((h) => `${h.to.join(", ")} on ${new Date(h.at).toLocaleString("en-AU", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}`).join("; ")}
              </div>
            )}
          </>
        )}

        {err && <p className="error" role="alert" style={{ margin: 0 }}>{err}</p>}
        <div className="row" style={{ gap: 8, justifyContent: "flex-end" }}>
          <button type="button" className="btn" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className="btn primary" disabled={busy || !draft?.canSend || !toList.valid.length || toList.invalid.length > 0 || ccList.invalid.length > 0} onClick={() => void send()}>
            {busy ? "Sending..." : toList.valid.length > 1 ? `Send to ${toList.valid.length} people` : "Send quote"}
          </button>
        </div>
      </div>
    </div>
  );
}
