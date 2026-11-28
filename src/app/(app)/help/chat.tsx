"use client";

import { useEffect, useRef, useState } from "react";
import { askHelp, sendChatToTeam, type ChatMsg } from "./chat-actions";

const STARTERS = ["How do I send a quote to the customer?", "How do I trace an area on the map?", "The customer wants changes after I sent it", "How do I give them two options?"];

/** Ask the help assistant how to use quoteout. */
export function HelpChat({ initial }: { initial: { chatId: string; messages: ChatMsg[] } | null }) {
  const [chatId, setChatId] = useState<string | null>(initial?.chatId ?? null);
  const [msgs, setMsgs] = useState<ChatMsg[]>(initial?.messages ?? []);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const from = useRef<string | null>(null);

  useEffect(() => {
    try { from.current = document.referrer ? new URL(document.referrer).pathname : null; } catch { from.current = null; }
  }, []);
  useEffect(() => { end.current?.scrollIntoView({ block: "nearest" }); }, [msgs, busy]);

  async function ask(q: string) {
    const t = q.trim();
    if (!t || busy) return;
    setBusy(true); setErr(null); setText("");
    setMsgs((m) => [...m, { role: "user", text: t, at: new Date().toISOString() }]);
    const r = await askHelp({ chatId, text: t, page: from.current });
    setBusy(false);
    if (!r.ok) { setErr(r.message); setMsgs((m) => m.slice(0, -1)); setText(t); return; }
    setChatId(r.chatId); setMsgs(r.messages);
  }
  async function toTeam() {
    if (!chatId) return;
    setBusy(true);
    const r = await sendChatToTeam({ chatId });
    setBusy(false);
    if (r.ok) setSent(r.message); else setErr(r.message);
  }
  const wantsPerson = msgs.length > 0 && msgs[msgs.length - 1].role === "assistant" && msgs[msgs.length - 1].person;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div aria-live="polite" style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: 460, overflowY: "auto", padding: 2 }}>
        {msgs.length === 0 && (
          <>
            <p className="sub" style={{ margin: 0 }}>Ask how to do anything in quoteout. For example:</p>
            <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
              {STARTERS.map((s) => <button key={s} type="button" className="btn" style={{ padding: "6px 10px", fontSize: 13 }} onClick={() => void ask(s)}>{s}</button>)}
            </div>
          </>
        )}
        {msgs.map((m, i) => (
          <div key={i} style={{ alignSelf: m.role === "user" ? "flex-end" : "flex-start", maxWidth: "88%", whiteSpace: "pre-wrap",
            background: m.role === "user" ? "var(--bitumen)" : "#f3f4f6", color: m.role === "user" ? "#fff" : "inherit", padding: "9px 12px", borderRadius: 12 }}>
            {m.text}
          </div>
        ))}
        {busy && <div className="sub" style={{ marginTop: 0 }}>Thinking...</div>}
        <div ref={end} />
      </div>
      {err && <p className="error" role="alert" style={{ margin: 0 }}>{err}</p>}
      <form className="row" style={{ gap: 8 }} onSubmit={(e) => { e.preventDefault(); void ask(text); }}>
        <input className="grow" value={text} onChange={(e) => setText(e.target.value)} placeholder="Type a question" aria-label="Your question" maxLength={2000} disabled={busy} />
        <button type="submit" className="btn primary" disabled={busy || text.trim().length < 2}>Ask</button>
      </form>
      {chatId && !sent && (
        <div className="row" style={{ gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <span className="sub" style={{ marginTop: 0 }}>{wantsPerson ? "This one's best for a person." : "Still stuck?"}</span>
          <button type="button" className={wantsPerson ? "btn primary" : "btn"} style={{ padding: "6px 10px" }} disabled={busy} onClick={() => void toTeam()}>Send this to the quoteout team</button>
          <button type="button" className="btn" style={{ padding: "6px 10px" }} disabled={busy} onClick={() => { setChatId(null); setMsgs([]); setErr(null); }}>New question</button>
        </div>
      )}
      {sent && <p style={{ color: "var(--good)", fontWeight: 600, margin: 0 }} role="status">{sent}</p>}
    </div>
  );
}
