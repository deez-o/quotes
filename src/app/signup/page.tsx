"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { PLANS } from "@/lib/plans";
import { Logo } from "../logo";
import { signUp } from "./actions";

const CHOICES = ["trial", "site", "pro", "business"] as const;

export default function SignUpPage() {
  const [plan, setPlan] = useState<(typeof CHOICES)[number]>("trial");
  const [company, setCompany] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [website, setWebsite] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const p = new URLSearchParams(window.location.search).get("plan");
    // eslint-disable-next-line react-hooks/set-state-in-effect -- read once from the URL after load
    if (p && (CHOICES as readonly string[]).includes(p)) setPlan(p as (typeof CHOICES)[number]);
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const r = await signUp({ company, email, password, plan, website });
    if (!r.ok) { setBusy(false); setError(r.message); return; }
    const { error } = await createClient().auth.signInWithPassword({ email: email.trim(), password });
    if (error) { setBusy(false); setError("Your account is made. Sign in to carry on."); return; }
    window.location.assign(r.next);
  }

  return (
    <main style={{ minHeight: "100dvh", display: "grid", placeItems: "center", alignContent: "center", gap: 20, padding: "32px 20px", background: "var(--bitumen)" }}>
      <div style={{ textAlign: "center" }}>
        <Logo size={44} dark />
        <p style={{ marginTop: 10, color: "#b6bcc4", fontSize: 15 }}>Your quotes, out the door.</p>
      </div>
      <form onSubmit={submit} className="card" style={{ width: "100%", maxWidth: 460, display: "flex", flexDirection: "column", gap: 12 }}>
        <h1 style={{ fontSize: 24 }}>Get started</h1>

        <fieldset style={{ border: 0, padding: 0, margin: 0, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          <legend style={{ fontWeight: 600, marginBottom: 8 }}>Plan</legend>
          {CHOICES.map((id) => {
            const p = PLANS[id];
            const on = plan === id;
            return (
              <label key={id} style={{ border: on ? "2px solid var(--brand)" : "1px solid #b6bcc4", borderRadius: 10, padding: on ? "9px 11px" : "10px 12px", cursor: "pointer", fontWeight: 400, background: on ? "#fff7f2" : "#fff" }}>
                <input type="radio" name="plan" value={id} checked={on} onChange={() => setPlan(id)} style={{ position: "absolute", opacity: 0, pointerEvents: "none" }} />
                <div style={{ fontWeight: 700 }}>{id === "trial" ? "Free trial" : p.name}</div>
                <div style={{ fontSize: 13, color: "var(--muted)" }}>{id === "trial" ? "14 days · 15 AI quotes · no card" : `$${p.priceMonthly}/mo + GST · ${p.aiQuotes} quotes`}</div>
              </label>
            );
          })}
        </fieldset>

        <label htmlFor="company">Company name</label>
        <input id="company" type="text" required autoComplete="organization" value={company} onChange={(e) => setCompany(e.target.value)} />
        <label htmlFor="email">Email</label>
        <input id="email" type="email" inputMode="email" autoCapitalize="none" autoCorrect="off" required autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} />
        <label htmlFor="password">Password</label>
        <input id="password" type="password" required minLength={8} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 8 characters" />
        <input type="text" name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" value={website} onChange={(e) => setWebsite(e.target.value)} style={{ position: "absolute", left: -9999, width: 1, height: 1 }} />

        <button type="submit" className="btn primary" disabled={busy} style={{ marginTop: 6 }}>
          {busy ? "Setting you up..." : plan === "trial" ? "Start free trial" : `Continue to payment`}
        </button>
        <p className="sub" style={{ margin: 0, fontSize: 13, textAlign: "center" }}>
          {plan === "trial" ? "No card needed. Pick a plan any time during the trial." : "You'll pay securely with Stripe. Cancel any time."}
        </p>
        {error && <p className="error" role="alert" style={{ margin: 0 }}>{error}</p>}
        <p style={{ margin: 0, textAlign: "center", fontSize: 14 }}>Already have a login? <Link href="/login" style={{ textDecoration: "underline" }}>Sign in</Link></p>
      </form>
    </main>
  );
}
