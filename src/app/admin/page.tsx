import Link from "next/link";
import { requireOwner } from "@/lib/owner";
import { placeName } from "@/lib/devices";
import { ago, loadAdmin } from "./data";

export const dynamic = "force-dynamic";

const STATUS: Record<string, { label: string; cls: string }> = {
  setup: { label: "Setting up", cls: "warn" },
  live: { label: "Live", cls: "good" },
  paused: { label: "Paused", cls: "bad" },
};

const PAY: Record<string, string> = { active: "paid", trialing: "paid", past_due: "payment failed", canceled: "cancelled", pending: "not paid yet", none: "not paid", unpaid: "unpaid", incomplete: "not paid yet" };

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="card" style={{ padding: "16px 18px" }}>
      <div style={{ fontSize: 13, color: "var(--muted)" }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 700, letterSpacing: "-0.02em", marginTop: 4 }}>{value}</div>
      {note && <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>{note}</div>}
    </div>
  );
}

export default async function AdminHome() {
  const { db } = await requireOwner();
  const a = await loadAdmin(db);
  const aud = (usd: number) => `$${(usd * 1.55).toFixed(2)}`;

  return (
    <>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <div>
          <h1>Overview</h1>
          <p className="sub">This month ({a.period}). Only quoteout staff can see this page.</p>
        </div>
        <Link href="/admin/new" className="btn primary">Add a company</Link>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 12 }}>
        <Stat label="Companies" value={String(a.totals.companies)} note={`${a.totals.paying} on a paid plan`} />
        <Stat label="Monthly revenue" value={`$${a.totals.monthlyRevenue.toLocaleString("en-AU")}`} note="Paid-up plans, ex GST" />
        <Stat label="People" value={String(a.totals.people)} note={`${a.totals.activeToday} active today`} />
        <Stat label="AI calls" value={String(a.totals.aiCalls)} note="Quotes, changes, price lists" />
        <Stat label="AI cost" value={aud(a.totals.aiCostUsd)} note={`about AUD (US$${a.totals.aiCostUsd.toFixed(2)})`} />
      </div>

      {a.flags.length > 0 && (
        <section className="card" style={{ borderColor: "var(--accent)" }}>
          <h2>Logins that look shared</h2>
          <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {a.flags.map((f, i) => (
              <li key={i} className="row" style={{ padding: "10px 0", borderTop: "1px solid var(--line-soft)", gap: 10 }}>
                <span className="grow"><strong>{f.person?.email ?? f.userId}</strong> · {f.reason}</span>
                <span className="sub" style={{ marginTop: 0 }}>{ago(f.at)}</span>
                {f.person && <Link className="btn" href={`/admin/companies/${f.person.tenantId}#p-${f.userId}`} style={{ padding: "6px 12px" }}>Look</Link>}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="card scroll" style={{ padding: 0 }}>
        <table className="list">
          <thead>
            <tr><th>Company</th><th>Plan</th><th>Status</th><th>People</th><th>AI quotes</th><th>Quotes</th><th>AI cost</th><th>Last active</th><th></th></tr>
          </thead>
          <tbody>
            {a.companies.map((c) => {
              const s = STATUS[c.status] ?? { label: c.status, cls: "quiet" };
              const cap = c.limits.aiQuotes;
              const over = cap != null && c.aiUsed >= cap;
              return (
                <tr key={c.id}>
                  <td><Link href={`/admin/companies/${c.id}`} style={{ fontWeight: 600, textDecoration: "underline" }}>{c.name}</Link><div className="sub" style={{ marginTop: 2, fontSize: 12 }}>{c.slug}@in.quoteout.app</div></td>
                  <td>{c.limits.plan.name}{c.limits.plan.priceMonthly ? <div className="sub" style={{ marginTop: 2, fontSize: 12 }}>${c.limits.plan.priceMonthly}/mo · {PAY[c.billing_status ?? "none"] ?? c.billing_status}</div> : c.limits.plan.id === "trial" && c.trial_ends_at ? <div className="sub" style={{ marginTop: 2, fontSize: 12 }}>ends {new Date(c.trial_ends_at).toLocaleDateString("en-AU")}</div> : null}</td>
                  <td><span className={`badge ${s.cls}`}>{s.label}</span></td>
                  <td>{c.people}</td>
                  <td><span style={over ? { color: "var(--accent-ink)", fontWeight: 600 } : undefined}>{c.aiUsed}{cap != null ? ` / ${cap}` : ""}</span></td>
                  <td>{c.quotesThisMonth}</td>
                  <td>{aud(c.aiCost)}</td>
                  <td>{ago(c.lastActive)}</td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    {c.flags > 0 && <span className="badge bad" style={{ marginRight: 6 }}>{c.flags} shared?</span>}
                    {c.problems > 0 && <span className="badge warn">{c.problems} problem{c.problems > 1 ? "s" : ""}</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <section className="card">
        <h2>System health</h2>
        <ul style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 6 }}>
          <li>
            Background jobs waiting: <strong>{a.health.queued}</strong>
            {a.health.oldestQueued && <span className="sub"> (oldest {ago(a.health.oldestQueued)}{a.health.stuck ? " — the timer may have stopped" : ""})</span>}
          </li>
          <li>Failed jobs: <strong>{a.health.failed.length}</strong>
            {a.health.failed.slice(0, 5).map((f, i) => <div key={i} className="sub" style={{ marginTop: 2, fontSize: 13 }}>{f.kind} · {ago(f.created_at)} · {f.last_error ?? "no detail"}</div>)}
          </li>
          <li>Connections with a problem: <strong>{a.health.badConnections.length}</strong>
            {a.health.badConnections.map((c, i) => (
              <div key={i} className="sub" style={{ marginTop: 2, fontSize: 13 }}>
                {a.companies.find((x) => x.id === c.tenant_id)?.name ?? "?"} · {c.provider} · {c.last_error ?? c.status}
              </div>
            ))}
          </li>
        </ul>
      </section>

      <section className="card">
        <h2>Recent sign-ins</h2>
        <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {a.devices.slice(0, 12).map((d) => {
            const p = a.people.find((x) => x.userId === d.user_id);
            return (
              <li key={d.id} className="row" style={{ padding: "8px 0", borderTop: "1px solid var(--line-soft)", gap: 10, fontSize: 14 }}>
                <span className="grow"><strong>{p?.email ?? d.user_id}</strong> · {d.label} · {placeName(d)}</span>
                <span className="sub" style={{ marginTop: 0 }}>{d.revoked_at ? "signed out" : ago(d.last_seen)}</span>
              </li>
            );
          })}
          {a.devices.length === 0 && <li className="sub">No sign-ins recorded yet. They appear within 5 minutes of someone using the app.</li>}
        </ul>
      </section>
    </>
  );
}
