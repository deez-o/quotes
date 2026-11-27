"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

/** Set or change your own password, so you can sign in without waiting for an email. */
export function PasswordForm() {
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (pw.length < 8) return setMsg({ ok: false, text: "Use at least 8 characters." });
    if (pw !== pw2) return setMsg({ ok: false, text: "The two passwords don't match." });
    setBusy(true);
    const { error } = await createClient().auth.updateUser({ password: pw });
    setBusy(false);
    if (error) return setMsg({ ok: false, text: error.message });
    setPw(""); setPw2("");
    setMsg({ ok: true, text: "Password saved. Next time, sign in with your email and this password." });
  }

  return (
    <form onSubmit={save} className="card" style={{ display: "flex", flexDirection: "column", gap: 10, maxWidth: 460 }}>
      <h2 style={{ margin: 0 }}>Your password</h2>
      <p className="sub" style={{ marginTop: 0 }}>Set a password to sign in straight away, without waiting for an email. Let your phone save it.</p>
      <input type="text" name="username" autoComplete="username" hidden readOnly />
      <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>New password
        <input type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} required />
      </label>
      <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>Type it again
        <input type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} required />
      </label>
      <div><button type="submit" className="btn primary" disabled={busy}>{busy ? "Saving..." : "Save password"}</button></div>
      {msg && <p className={msg.ok ? "sub" : "error"} role="status" style={{ margin: 0, color: msg.ok ? "var(--good)" : undefined }}>{msg.text}</p>}
    </form>
  );
}
