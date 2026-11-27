"use client";

import { useEffect, useState } from "react";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { Logo } from "../logo";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [forgot, setForgot] = useState(false);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const e = q.get("error");
    const m = q.get("m");
    const why: Record<string, string> = {
      ended: "You were signed out because this login was used on another device. Each login is for one person.",
      suspended: "This login has been switched off. Talk to your company's quoteout admin.",
      paused: "Your company's quoteout account is paused. Contact quoteout to switch it back on.",
    };
    // eslint-disable-next-line react-hooks/set-state-in-effect -- read once from the URL after load
    if (e) setError(e === "sign-in-failed" ? "Sign-in failed. Please try again." : e);
    else if (m && why[m]) setError(why[m]);
  }, []);

  async function signIn(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await createClient().auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (error) {
      setError(error.message === "Invalid login credentials" ? "That email and password don't match." : error.message);
      return;
    }
    const next = new URLSearchParams(window.location.search).get("next");
    window.location.assign(next && next.startsWith("/") && !next.startsWith("//") ? next : "/");
  }

  async function sendReset(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    // The reset link carries the session itself, so it works on any phone or computer.
    const sender = createSupabaseClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { auth: { flowType: "implicit", persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
    const { error } = await sender.auth.resetPasswordForEmail(email.trim(), { redirectTo: `${window.location.origin}/auth/session` });
    setBusy(false);
    if (error) setError(error.message);
    else setSent(true);
  }

  return (
    <main style={{ minHeight: "100dvh", display: "grid", placeItems: "center", alignContent: "center", gap: 20, padding: "32px 20px", background: "var(--bitumen)" }}>
      <div style={{ textAlign: "center" }}>
        <Logo size={44} dark />
        <p style={{ marginTop: 10, color: "#b6bcc4", fontSize: 15 }}>Your quotes, out the door.</p>
      </div>
      <div className="card" style={{ width: "100%", maxWidth: 400, display: "flex", flexDirection: "column", gap: 16 }}>
        <h1 style={{ fontSize: 24 }}>{forgot ? "Reset your password" : "Sign in"}</h1>

        {forgot ? (
          sent ? (
            <>
              <p style={{ margin: 0 }}>If <strong>{email}</strong> has a quoteout login, we&apos;ve emailed it a link to set a new password.</p>
              <button type="button" className="btn" onClick={() => { setForgot(false); setSent(false); }}>Back to sign in</button>
            </>
          ) : (
            <form onSubmit={sendReset} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <label htmlFor="email">Email</label>
              <input id="email" type="email" inputMode="email" autoCapitalize="none" autoCorrect="off" required autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} />
              <button type="submit" className="btn primary" disabled={busy}>{busy ? "Sending..." : "Email me a reset link"}</button>
              <button type="button" className="btn" onClick={() => { setForgot(false); setError(null); }}>Back to sign in</button>
            </form>
          )
        ) : (
          <form onSubmit={signIn} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <label htmlFor="email">Email</label>
            <input id="email" type="email" inputMode="email" autoCapitalize="none" autoCorrect="off" required autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} />
            <label htmlFor="password">Password</label>
            <input id="password" type="password" required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
            <button type="submit" className="btn primary" disabled={busy} style={{ marginTop: 6 }}>{busy ? "Signing in..." : "Sign in"}</button>
            <button type="button" onClick={() => { setForgot(true); setError(null); }}
              style={{ background: "none", border: 0, color: "var(--muted)", font: "inherit", fontSize: 14, textDecoration: "underline", cursor: "pointer", padding: 4 }}>
              Forgot your password?
            </button>
          </form>
        )}

        {error && <p className="error" role="alert" style={{ margin: 0 }}>{error}</p>}
      </div>
    </main>
  );
}
