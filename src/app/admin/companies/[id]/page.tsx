import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOwner } from "@/lib/owner";
import { placeName } from "@/lib/devices";
import { ago, loadAdmin } from "../../data";
import { workInCompany } from "../../actions";
import { AddPersonForm, CompanyForm, DeviceSignOut, PersonActions } from "../../forms";

export const dynamic = "force-dynamic";

const KIND: Record<string, string> = { ai_quote: "Quotes built", ai_change: "Changes", ai_price_list: "Price lists read", ai_rfq: "RFQs drafted" };
const ROLE: Record<string, string> = { admin: "Client admin", estimator: "Estimator", viewer: "Viewer" };

export default async function CompanyPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ made?: string }> }) {
  const { id } = await params;
  const { made } = await searchParams;
  const { db, userId: me } = await requireOwner();
  const a = await loadAdmin(db);
  const c = a.companies.find((x) => x.id === id);
  if (!c) notFound();

  const people = a.people.filter((p) => p.tenantId === id);
  const flagged = new Map(a.flags.filter((f) => people.some((p) => p.userId === f.userId)).map((f) => [f.userId, f.reason]));
  const usage = a.usage.filter((u) => u.tenant_id === id);
  const byKind = Object.entries(usage.reduce<Record<string, number>>((m, u) => ({ ...m, [u.kind]: (m[u.kind] ?? 0) + Number(u.qty) }), {}));
  const { data: staff } = await db.from("platform_admins").select("user_id");
  const staffIds = new Set((staff ?? []).map((s) => s.user_id as string));
  const cap = c.limits.aiQuotes;

  return (
    <>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <div>
          <Link href="/admin" className="btn back-btn">← Back to Overview</Link>
          <h1 style={{ marginTop: 6 }}>{c.name}</h1>
          <p className="sub">Forwarding address: <strong>{c.slug}@in.quoteout.app</strong> · joined {new Date(c.created_at).toLocaleDateString("en-AU")}</p>
        </div>
        <form action={workInCompany}>
          <input type="hidden" name="tenant_id" value={c.id} />
          <button className="btn dark">Set up their account</button>
        </form>
      </div>

      {made && <p className="card" style={{ background: "var(--good-bg)", borderColor: "var(--good)", margin: 0 }}>Company created and invite sent. Next: <strong>Set up their account</strong> to load their rates, plants and rules.</p>}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 12 }}>
        <div className="card" style={{ padding: "16px 18px" }}>
          <div style={{ fontSize: 13, color: "var(--muted)" }}>AI quotes this month</div>
          <div style={{ fontSize: 28, fontWeight: 700 }}>{c.aiUsed}{cap != null ? <span style={{ fontSize: 16, color: "var(--muted)" }}> / {cap}</span> : null}</div>
          {cap != null && <div style={{ height: 6, background: "var(--line-soft)", borderRadius: 3, marginTop: 8 }}><div style={{ width: `${Math.min(100, (c.aiUsed / Math.max(cap, 1)) * 100)}%`, height: 6, borderRadius: 3, background: c.aiUsed >= cap ? "var(--accent)" : "var(--brand)" }} /></div>}
        </div>
        <div className="card" style={{ padding: "16px 18px" }}>
          <div style={{ fontSize: 13, color: "var(--muted)" }}>Quotes this month</div>
          <div style={{ fontSize: 28, fontWeight: 700 }}>{c.quotesThisMonth}</div>
        </div>
        <div className="card" style={{ padding: "16px 18px" }}>
          <div style={{ fontSize: 13, color: "var(--muted)" }}>AI cost this month</div>
          <div style={{ fontSize: 28, fontWeight: 700 }}>${(c.aiCost * 1.55).toFixed(2)}</div>
          <div style={{ fontSize: 12, color: "var(--muted)" }}>about AUD · {byKind.map(([k, n]) => `${n} ${(KIND[k] ?? k).toLowerCase()}`).join(" · ") || "no AI use yet"}</div>
        </div>
        <div className="card" style={{ padding: "16px 18px" }}>
          <div style={{ fontSize: 13, color: "var(--muted)" }}>Plan</div>
          <div style={{ fontSize: 28, fontWeight: 700 }}>{c.limits.plan.name}</div>
          <div style={{ fontSize: 12, color: "var(--muted)" }}>{c.limits.plan.priceMonthly ? `$${c.limits.plan.priceMonthly}/mo ex GST` : "Free"}{c.trial_ends_at ? ` · trial ends ${new Date(c.trial_ends_at).toLocaleDateString("en-AU")}` : ""}</div>
        </div>
      </div>

      <section>
        <h2>Plan and limits</h2>
        <CompanyForm c={c} />
      </section>

      <section className="card">
        <h2>People</h2>
        <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {people.map((p) => {
            const devices = a.devices.filter((d) => d.user_id === p.userId);
            const live = devices.filter((d) => !d.revoked_at);
            return (
              <li key={p.userId} id={`p-${p.userId}`} style={{ padding: "14px 0", borderTop: "1px solid var(--line-soft)", display: "flex", flexDirection: "column", gap: 8 }}>
                <div className="row" style={{ gap: 10, alignItems: "flex-start" }}>
                  <div className="grow">
                    <strong>{p.email}</strong>{" "}
                    <span className="badge quiet">{ROLE[p.role] ?? p.role}</span>{" "}
                    {staffIds.has(p.userId) && <span className="badge warn">quoteout staff</span>}{" "}
                    {p.disabledAt && <span className="badge bad">Switched off</span>}{" "}
                    {flagged.has(p.userId) && <span className="badge bad">Looks shared: {flagged.get(p.userId)}</span>}
                    <div className="sub" style={{ marginTop: 4, fontSize: 13 }}>
                      Last sign-in {ago(p.lastSignIn)} · {live.length} device{live.length === 1 ? "" : "s"} in use · {a.quotesByUser.get(p.userId) ?? 0} quick quotes this month
                    </div>
                  </div>
                  <PersonActions tenantId={id} userId={p.userId} role={p.role} disabled={Boolean(p.disabledAt)} isMe={p.userId === me} />
                </div>
                {devices.length > 0 && (
                  <table className="list" style={{ fontSize: 13 }}>
                    <tbody>
                      {devices.map((d) => (
                        <tr key={d.id}>
                          <td style={{ padding: "6px 8px" }}>{d.label ?? "Unknown device"}</td>
                          <td style={{ padding: "6px 8px" }}>{placeName(d)}{d.ip ? <span className="sub" style={{ fontSize: 11 }}> · {d.ip}</span> : null}</td>
                          <td style={{ padding: "6px 8px" }}>{d.revoked_at ? <span className="sub" style={{ marginTop: 0 }}>Signed out ({d.revoked_reason ?? "ended"})</span> : `Active ${ago(d.last_seen)}`}</td>
                          <td style={{ padding: "6px 8px", textAlign: "right" }}>{!d.revoked_at && <DeviceSignOut tenantId={id} deviceRowId={d.id} />}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </li>
            );
          })}
          {people.length === 0 && <li className="sub">No one yet.</li>}
        </ul>
        <div style={{ borderTop: "1px solid var(--line-soft)", paddingTop: 14, marginTop: 4 }}>
          <AddPersonForm tenantId={id} />
        </div>
      </section>
    </>
  );
}
