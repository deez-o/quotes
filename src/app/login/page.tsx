"use client";

import { useEffect, useState } from "react";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { Logo } from "../logo";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const e = new URLSearchParams(window.location.search).get("error");
    // eslint-disable-next-line react-hooks/set-state-in-effect -- read once from the URL after load
    if (e) setError(e === "sign-in-failed" ? "Sign-in failed. Please request a new link." : e);
  }, []);

  const redirectTo = () => `${window.location.origin}/auth/callback`;

  async function sendLink(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    // Email links use the "implicit" flow so they work in any browser, not
    // just the one where the email was requested.
    const sender = createSupabaseClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { auth: { flowType: "implicit", persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } },
    );
    const { error } = await sender.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/auth/session`, shouldCreateUser: true },
    });
    setBusy(false);
    if (error) setError(error.message);
    else setSent(true);
  }

  async function microsoft() {
    setError(null);
    const { error } = await createClient().auth.signInWithOAuth({
      provider: "azure",
      options: { redirectTo: redirectTo(), scopes: "email openid profile" },
    });
    if (error) setError(error.message);
  }

  return (
    <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", alignContent: "center", gap: 20, padding: 24, background: "var(--bitumen)" }}>
      <div style={{ textAlign: "center", color: "var(--line-white)" }}>
        <Logo size={44} dark />
        <p style={{ marginTop: 10, color: "#b5b2ab", fontSize: 15 }}>Your quotes, out the door.</p>
      </div>
      <div className="card" style={{ width: "100%", maxWidth: 420, display: "flex", flexDirection: "column", gap: 16 }}>
        <div>
          <h1 style={{ fontSize: 24 }}>Sign in</h1>
          <p className="sub">Use the email your company set up for you.</p>
        </div>

        <button type="button" className="btn dark" onClick={microsoft}>
          Sign in with Microsoft
        </button>

        <div style={{ color: "var(--muted)", textAlign: "center", fontSize: 13 }}>or</div>

        {sent ? (
          <p>Check your inbox: we&apos;ve sent a sign-in link to <strong>{email}</strong>.</p>
        ) : (
          <form onSubmit={sendLink} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <label htmlFor="email">Work email</label>
            <input
              id="email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <button type="submit" className="btn primary" disabled={busy}>
              {busy ? "Sending..." : "Email me a sign-in link"}
            </button>
          </form>
        )}

        {error && <p className="error" role="alert">{error}</p>}
      </div>
    </main>
  );
}
