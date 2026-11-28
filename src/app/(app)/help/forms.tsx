"use client";

import { useActionState, useRef } from "react";
import { requestClose, sendHelp, type HelpState } from "./actions";

export function HelpForm() {
  const [state, action, pending] = useActionState<HelpState, FormData>(sendHelp, null);
  const page = useRef<HTMLInputElement>(null);
  if (state?.ok) return <p style={{ color: "var(--good)", fontWeight: 600 }} role="status">{state.message}</p>;
  return (
    <form action={action} onSubmit={() => { if (page.current && document.referrer) { try { page.current.value = new URL(document.referrer).pathname; } catch { /* ignore */ } } }} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <input ref={page} type="hidden" name="page" defaultValue="" />
      <label style={{ display: "flex", flexDirection: "column", gap: 4, fontWeight: 600 }}>What&apos;s it about?
        <select name="topic" defaultValue="Question">
          {["Question", "Something's not working", "Idea", "Billing"].map((t) => <option key={t}>{t}</option>)}
        </select>
      </label>
      <label style={{ display: "flex", flexDirection: "column", gap: 4, fontWeight: 600 }}>Message
        <textarea name="message" rows={5} required placeholder="What were you trying to do, and what happened?" />
      </label>
      {state && !state.ok && <p className="error" role="alert" style={{ margin: 0 }}>{state.message}</p>}
      <div><button type="submit" className="btn primary" disabled={pending}>{pending ? "Sending..." : "Send to quoteout"}</button></div>
    </form>
  );
}

export function CloseForm({ company }: { company: string }) {
  const [state, action, pending] = useActionState<HelpState, FormData>(requestClose, null);
  if (state?.ok) return <p style={{ fontWeight: 600 }} role="status">{state.message}</p>;
  return (
    <form action={action} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <label style={{ display: "flex", flexDirection: "column", gap: 4, fontWeight: 600 }}>Why are you leaving? <span style={{ fontWeight: 400 }} className="sub">(optional, it helps us)</span>
        <textarea name="reason" rows={3} />
      </label>
      <label style={{ display: "flex", flexDirection: "column", gap: 4, fontWeight: 600 }}>Type {company} to confirm
        <input name="confirm" autoComplete="off" required />
      </label>
      {state && !state.ok && <p className="error" role="alert" style={{ margin: 0 }}>{state.message}</p>}
      <div><button type="submit" className="btn" disabled={pending} style={{ borderColor: "#f0b8a8", color: "#9a3412" }}>{pending ? "Closing..." : "Close our account"}</button></div>
    </form>
  );
}
