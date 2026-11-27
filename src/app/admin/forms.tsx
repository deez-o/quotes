"use client";

import { useActionState, useState, useTransition } from "react";
import { PLANS, PLAN_ORDER } from "@/lib/plans";
import { addPerson, createCompany, saveCompany, sendPasswordReset, setPassword, setPersonEnabled, setPersonRole, signOutDevice, signOutEverywhere } from "./actions";

type R = { ok: true; message?: string } | { ok: false; message: string } | null;

function Msg({ r }: { r: R }) {
  if (!r) return null;
  return <p role="status" className={r.ok ? "" : "error"} style={r.ok ? { color: "var(--good)", fontWeight: 600, margin: 0 } : { margin: 0 }}>{r.message}</p>;
}

const small = { display: "flex", flexDirection: "column" as const, gap: 4, fontSize: 13 };
const sel = { font: "inherit", border: "1px solid #b6bcc4", borderRadius: 8, padding: 11, background: "#fff" };

export function CompanyForm({ c }: {
  c: { id: string; name: string; plan: string | null; status: string; billing_status: string | null; stripe_subscription_id: string | null; ai_quota_month: number | null; max_devices: number | null; trial_ends_at: string | null; admin_note: string | null };
}) {
  const [r, act, pending] = useActionState(saveCompany, null);
  const [plan, setPlan] = useState(c.plan && PLANS[c.plan as keyof typeof PLANS] ? c.plan : "trial");
  const p = PLANS[plan as keyof typeof PLANS];
  const trial = c.trial_ends_at ? new Date(c.trial_ends_at).toLocaleDateString("en-CA", { timeZone: "Australia/Brisbane" }) : "";
  return (
    <form action={act} className="card" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 12 }}>
      <input type="hidden" name="id" value={c.id} />
      <label style={{ ...small, gridColumn: "1 / -1" }}>Company name<input type="text" name="name" defaultValue={c.name} required /></label>
      <label style={small}>Plan
        <select name="plan" style={sel} value={plan} onChange={(e) => setPlan(e.target.value)}>
          {PLAN_ORDER.map((id) => <option key={id} value={id}>{PLANS[id].name}{PLANS[id].priceMonthly ? ` · $${PLANS[id].priceMonthly}/mo` : ""}</option>)}
        </select>
      </label>
      <label style={small}>Status
        <select name="status" style={sel} defaultValue={c.status}>
          <option value="setup">Setting up</option>
          <option value="live">Live</option>
          <option value="paused">Paused (everyone signed out)</option>
        </select>
      </label>
      <label style={small}>Payment status
        <select name="billing_status" style={sel} defaultValue={["none", "pending", "active", "past_due", "canceled"].includes(c.billing_status ?? "") ? c.billing_status ?? "none" : "active"}>
          <option value="active">Paid up</option>
          <option value="past_due">Payment failed (7 days&apos; grace)</option>
          <option value="canceled">Cancelled (locked)</option>
          <option value="pending">Waiting for first payment (locked)</option>
          <option value="none">Not paid (locked on paid plans)</option>
        </select>
      </label>
      <label style={small}>AI quotes a month
        <input type="text" inputMode="numeric" name="ai_quota_month" defaultValue={c.ai_quota_month ?? ""} placeholder={p.aiQuotes == null ? "No limit (plan)" : `${p.aiQuotes} (plan)`} />
      </label>
      <label style={small}>Devices per login
        <input type="text" inputMode="numeric" name="max_devices" defaultValue={c.max_devices ?? ""} placeholder={p.maxDevices == null ? "No limit (plan)" : `${p.maxDevices} (plan)`} />
      </label>
      <label style={small}>Trial ends<input type="date" name="trial_ends_at" defaultValue={trial} style={sel} /></label>
      <label style={{ ...small, gridColumn: "1 / -1" }}>Notes (only you see these)<textarea name="admin_note" rows={2} defaultValue={c.admin_note ?? ""} /></label>
      <div className="row" style={{ gridColumn: "1 / -1", gap: 12 }}>
        <button className="btn dark" disabled={pending}>{pending ? "Saving..." : "Save"}</button>
        <span className="sub" style={{ marginTop: 0, fontSize: 13 }}>{p.blurb} Leave a limit blank to use the plan&apos;s. {c.stripe_subscription_id ? "Pays through Stripe: Stripe updates the plan and payment status itself." : "Not on Stripe: set Paid up to give them a paid plan you invoice yourself."}</span>
        <Msg r={r} />
      </div>
    </form>
  );
}

export function NewCompanyForm() {
  const [r, act, pending] = useActionState(createCompany, null);
  return (
    <form action={act} className="card" style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 560 }}>
      <label style={small}>Company name<input type="text" name="name" required placeholder="e.g. Smith Asphalt" /></label>
      <label style={small}>Email of the person who&apos;ll run it<input type="email" name="email" required placeholder="owner@smithasphalt.com.au" /></label>
      <label style={small}>Starting password (optional)
        <input type="text" name="password" autoComplete="off" placeholder="Leave blank to email them an invite instead" />
      </label>
      <label style={small}>Plan
        <select name="plan" style={sel} defaultValue="trial">
          {PLAN_ORDER.map((id) => <option key={id} value={id}>{PLANS[id].name}{PLANS[id].priceMonthly ? ` · $${PLANS[id].priceMonthly}/mo` : ""}</option>)}
        </select>
      </label>
      <p className="sub" style={{ margin: 0, fontSize: 13 }}>With a starting password their login works straight away and you tell them the password; without one they get an email to choose their own. Their RFQ forwarding address is made from the company name. Then use &quot;Set up their account&quot; to load their rates, plants and rules.</p>
      <div className="row" style={{ gap: 12 }}>
        <button className="btn primary" disabled={pending}>{pending ? "Creating..." : "Create company"}</button>
        <Msg r={r} />
      </div>
    </form>
  );
}

export function AddPersonForm({ tenantId }: { tenantId: string }) {
  const [r, act, pending] = useActionState(addPerson, null);
  return (
    <form action={act} className="row" style={{ gap: 8, alignItems: "end" }}>
      <input type="hidden" name="tenant_id" value={tenantId} />
      <label style={{ ...small, flex: "2 1 220px" }}>Email<input type="email" name="email" required placeholder="name@company.com.au" /></label>
      <label style={{ ...small, flex: "1 1 180px" }}>Starting password (optional)
        <input type="text" name="password" autoComplete="off" placeholder="Blank = email invite" />
      </label>
      <label style={{ ...small, flex: "1 1 140px" }}>Role
        <select name="role" style={sel} defaultValue="estimator">
          <option value="admin">Client admin</option>
          <option value="estimator">Estimator</option>
          <option value="viewer">Viewer</option>
        </select>
      </label>
      <button className="btn" disabled={pending}>{pending ? "Adding..." : "Add person"}</button>
      <div style={{ width: "100%" }}><Msg r={r} /></div>
    </form>
  );
}

export function PersonActions({ tenantId, userId, role, disabled, isMe }: { tenantId: string; userId: string; role: string; disabled: boolean; isMe: boolean }) {
  const [r, setR] = useState<R>(null);
  const [pending, start] = useTransition();
  const [confirm, setConfirm] = useState<string | null>(null);
  const [newPw, setNewPw] = useState<string | null>(null);
  const run = (key: string, fn: () => Promise<R>) => {
    if (confirm !== key) { setConfirm(key); setR(null); return; }
    setConfirm(null);
    start(async () => setR(await fn()));
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-end" }}>
      <div className="row" style={{ gap: 6, justifyContent: "flex-end" }}>
        <select aria-label="Role" style={{ ...sel, padding: "6px 8px", fontSize: 13 }} defaultValue={role} disabled={pending}
          onChange={(e) => start(async () => setR(await setPersonRole({ tenantId, userId, role: e.target.value })))}>
          <option value="admin">Client admin</option>
          <option value="estimator">Estimator</option>
          <option value="viewer">Viewer</option>
        </select>
        <button type="button" className="btn" style={{ padding: "6px 10px", fontSize: 13 }} disabled={pending}
          onClick={() => run("all", () => signOutEverywhere({ tenantId, userId }))}>
          {confirm === "all" ? "Tap again to sign out" : "Sign out everywhere"}
        </button>
        {!isMe && (
          <button type="button" className="btn" disabled={pending}
            style={{ padding: "6px 10px", fontSize: 13, ...(disabled ? {} : { borderColor: "#f0b8a8", background: "#fdf1ed", color: "#9a3412" }) }}
            onClick={() => run("toggle", () => setPersonEnabled({ tenantId, userId, enabled: disabled }))}>
            {confirm === "toggle" ? "Tap again to confirm" : disabled ? "Switch login on" : "Switch login off"}
          </button>
        )}
      </div>
      <div className="row" style={{ gap: 6, justifyContent: "flex-end" }}>
        <button type="button" className="btn" style={{ padding: "6px 10px", fontSize: 13 }} disabled={pending}
          onClick={() => start(async () => setR(await sendPasswordReset({ tenantId, userId })))}>Email reset link</button>
        {newPw === null ? (
          <button type="button" className="btn" style={{ padding: "6px 10px", fontSize: 13 }} disabled={pending} onClick={() => setNewPw("")}>Set password</button>
        ) : (
          <>
            <input type="text" aria-label="New password" autoComplete="off" value={newPw} onChange={(e) => setNewPw(e.target.value)} placeholder="New password (8+)" style={{ width: 170, padding: "6px 8px", fontSize: 13 }} />
            <button type="button" className="btn dark" style={{ padding: "6px 10px", fontSize: 13 }} disabled={pending || newPw.length < 8}
              onClick={() => start(async () => { const res = await setPassword({ tenantId, userId, password: newPw }); setR(res); if (res.ok) setNewPw(null); })}>Save</button>
            <button type="button" className="btn" style={{ padding: "6px 10px", fontSize: 13 }} onClick={() => setNewPw(null)}>Cancel</button>
          </>
        )}
      </div>
      <Msg r={r} />
    </div>
  );
}

export function DeviceSignOut({ tenantId, deviceRowId }: { tenantId: string; deviceRowId: string }) {
  const [r, setR] = useState<R>(null);
  const [pending, start] = useTransition();
  if (r?.ok) return <span className="sub" style={{ marginTop: 0, fontSize: 12 }}>Signing out...</span>;
  return (
    <span>
      <button type="button" className="btn" style={{ padding: "4px 8px", fontSize: 12 }} disabled={pending}
        onClick={() => start(async () => setR(await signOutDevice({ tenantId, deviceRowId })))}>Sign out</button>
      {r && !r.ok && <span className="error" style={{ fontSize: 12, marginLeft: 6 }}>{r.message}</span>}
    </span>
  );
}
