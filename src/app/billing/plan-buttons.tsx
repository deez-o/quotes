"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { choosePlan, manageBilling } from "./actions";

export function PlanButton({ plan, label, primary, confirmText, autoStart }: { plan: string; label: string; primary?: boolean; confirmText?: string; autoStart?: boolean }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [confirming, setConfirming] = useState(false);
  const started = useRef(false);

  const go = () => start(async () => {
    const r = await choosePlan(plan);
    if (r.ok && r.url) { window.location.assign(r.url); return; }
    setMsg(r.ok ? { ok: true, text: r.message ?? "Done." } : { ok: false, text: r.message });
    setConfirming(false);
  });

  useEffect(() => {
    if (autoStart && !started.current) { started.current = true; go(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once on arrival from sign-up
  }, [autoStart]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <button type="button" className={`btn ${primary ? "primary" : ""}`} disabled={pending}
        onClick={() => (confirmText && !confirming ? setConfirming(true) : go())}>
        {pending ? "Opening..." : confirming ? confirmText : label}
      </button>
      {msg && <span role="status" className={msg.ok ? "" : "error"} style={{ fontSize: 13, ...(msg.ok ? { color: "var(--good)", fontWeight: 600 } : {}) }}>{msg.text}</span>}
    </div>
  );
}

export function ManageBillingButton() {
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  return (
    <span>
      <button type="button" className="btn" disabled={pending} onClick={() => start(async () => {
        const r = await manageBilling();
        if (r.ok && r.url) window.location.assign(r.url); else if (!r.ok) setErr(r.message);
      })}>{pending ? "Opening..." : "Card details and invoices"}</button>
      {err && <span className="error" style={{ fontSize: 13, marginLeft: 8 }}>{err}</span>}
    </span>
  );
}
