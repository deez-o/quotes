"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const redirectTo = () => `${window.location.origin}/auth/callback`;

  async function sendLink(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await createClient().auth.signInWithOtp({
      email,
      options: { emailRedirectTo: redirectTo(), shouldCreateUser: true },
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
    <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24 }}>
      <div className="card" style={{ width: "100%", maxWidth: 420, display: "flex", flexDirection: "column", gap: 16 }}>
        <div>
          <h1>QUOTES</h1>
          <p className="sub">Sign in to your account</p>
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
