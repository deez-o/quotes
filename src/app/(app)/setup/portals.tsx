"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { PORTAL_PROVIDERS } from "@/lib/portal/providers";
import { removePortal, savePortal } from "./portal-actions";

export type PortalRow = { provider: string; username: string | null; status: string; lastError: string | null; lastOk: string | null };

/** Tender portal logins: quoteout signs in with these to download tender documents for you. */
export function PortalLogins({ rows, isAdmin }: { rows: PortalRow[]; isAdmin: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [provider, setProvider] = useState<string>(PORTAL_PROVIDERS.find((p) => !rows.some((r) => r.provider === p.provider))?.provider ?? "estimateone");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const name = (p: string) => PORTAL_PROVIDERS.find((x) => x.provider === p)?.name ?? p;

  return (
    <section id="portals" className="card" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <h2 style={{ margin: 0 }}>Tender portals</h2>
      <p className="sub" style={{ marginTop: 0 }}>
        When an invite comes from EstimateOne or another portal, quoteout signs in with your login, downloads the tender documents and prices the quote.
        Your password is encrypted and never shown again. quoteout only downloads documents: it never responds to the builder or submits anything.
      </p>
      {rows.map((r) => (
        <div key={r.provider} className="row" style={{ gap: 10, alignItems: "center", flexWrap: "wrap", padding: "8px 10px", border: "1px solid var(--line, #e1e4e8)", borderRadius: 8 }}>
          <strong style={{ minWidth: 140 }}>{name(r.provider)}</strong>
          <span>{r.username}</span>
          <span className="sub" style={{ marginTop: 0, color: r.status === "error" ? "var(--bad, #b42318)" : "var(--good)" }}>
            {r.status === "error" ? `Not working: ${r.lastError ?? "sign-in failed"}. Save it again.` : r.lastOk ? "Working" : "Saved, not used yet"}
          </span>
          {isAdmin && (
            <button type="button" className="btn" disabled={pending} style={{ marginLeft: "auto", padding: "6px 10px" }}
              onClick={() => start(async () => { const x = await removePortal({ provider: r.provider }); setMsg({ ok: x.ok, text: x.message }); router.refresh(); })}>Remove</button>
          )}
        </div>
      ))}
      {isAdmin && (
        <form onSubmit={(e) => {
          e.preventDefault();
          start(async () => {
            const x = await savePortal({ provider, username, password });
            setMsg({ ok: x.ok, text: x.message });
            if (x.ok) { setPassword(""); setUsername(""); router.refresh(); }
          });
        }} style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "flex-end" }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13 }}>Portal
            <select value={provider} onChange={(e) => setProvider(e.target.value)} style={{ font: "inherit", padding: "9px 10px", borderRadius: 8, border: "1px solid #b6bcc4" }}>
              {PORTAL_PROVIDERS.map((p) => <option key={p.provider} value={p.provider}>{p.name}</option>)}
            </select>
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13, flex: "1 1 200px" }}>Email you sign in with
            <input type="email" autoComplete="off" value={username} onChange={(e) => setUsername(e.target.value)} />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13, flex: "1 1 160px" }}>Password
            <input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </label>
          <button type="submit" className="btn primary" disabled={pending || !username || !password}>{rows.some((r) => r.provider === provider) ? "Update login" : "Save login"}</button>
        </form>
      )}
      {msg && <span className={msg.ok ? "sub" : "error"} role="status" style={{ marginTop: 0, color: msg.ok ? "var(--good)" : undefined }}>{msg.text}</span>}
    </section>
  );
}
