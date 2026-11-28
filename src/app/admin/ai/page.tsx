import Link from "next/link";
import { requireOwner } from "@/lib/owner";
import { keyFor, liveModel } from "@/lib/ai/call";
import { AI_MODELS, modelInfo } from "@/lib/ai/models";
import type { SiteScope } from "@/lib/site/price";
import { CompareModelsForm, LiveModelForm, TrialForm } from "./forms";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const money = (n: number | null) => (n == null ? "–" : `$${Number(n).toLocaleString("en-AU", { maximumFractionDigits: 0 })}`);

export default async function AiPage({ searchParams }: { searchParams: Promise<{ batch?: string }> }) {
  const { db } = await requireOwner();
  const { batch } = await searchParams;
  const live = await liveModel();
  const models = AI_MODELS.map((m) => ({ ...m, hasKey: Boolean(keyFor(m.id)) }));

  const { data: cmp } = await db.from("platform_settings").select("value").eq("key", "compare_models").maybeSingle();
  const picked = Array.isArray(cmp?.value) ? (cmp!.value as unknown[]).map(String) : [];
  const [{ data: jobs }, { data: tenants }, { data: recent }, { data: rows }] = await Promise.all([
    db.from("jobs").select("id, tenant_id, quote_no, site, customer_name, created_at").eq("module", "quoting").order("created_at", { ascending: false }).limit(60),
    db.from("tenants").select("id, name"),
    db.from("ai_trials").select("batch_id, job_id, tenant_id, model, created_at").order("created_at", { ascending: false }).limit(200),
    batch ? db.from("ai_trials").select("*").eq("batch_id", batch).order("model") : Promise.resolve({ data: null }),
  ]);
  const nameOf = new Map((tenants ?? []).map((t) => [t.id as string, t.name as string]));
  const jobLabel = (tenantId: string, jobId: string) => {
    const j = (jobs ?? []).find((x) => x.id === jobId);
    return `${nameOf.get(tenantId) ?? "?"} · ${j?.quote_no ?? ""} ${j?.site ?? j?.customer_name ?? "RFQ"}`.trim();
  };
  const batches = [...new Map((recent ?? []).map((r) => [r.batch_id as string, r])).values()].slice(0, 12);

  return (
    <>
      <div>
        <Link href="/admin" className="btn back-btn">← Back to Overview</Link>
        <h1 style={{ marginTop: 6 }}>AI model</h1>
        <p className="sub">Which AI reads RFQs and site talk for every company, and a test bench to compare models on real RFQs before you switch.</p>
      </div>

      <section>
        <h2>Model in use</h2>
        <LiveModelForm models={models} live={live} />
      </section>

      <section>
        <h2>Two drafts of every RFQ</h2>
        <CompareModelsForm models={models} live={live} picked={picked} />
      </section>

      <section>
        <h2>Test bench</h2>
        <TrialForm models={models} jobs={(jobs ?? []).map((j) => ({ value: `${j.tenant_id}:${j.id}`, label: `${nameOf.get(j.tenant_id) ?? "?"} · ${j.quote_no ?? ""} ${j.site ?? j.customer_name ?? "RFQ"} · ${new Date(j.created_at).toLocaleDateString("en-AU")}` }))} />
      </section>

      {rows && rows.length > 0 && (
        <section>
          <h2>Results: {jobLabel(rows[0].tenant_id, rows[0].job_id)}</h2>
          <div style={{ display: "grid", gridTemplateColumns: `repeat(${rows.length}, minmax(280px, 1fr))`, gap: 12, overflowX: "auto" }}>
            {rows.map((r) => {
              const s = r.scope as SiteScope | null;
              return (
                <div key={r.id} className="card" style={{ display: "flex", flexDirection: "column", gap: 10, minWidth: 280 }}>
                  <div>
                    <strong style={{ fontSize: 17 }}>{modelInfo(r.model)?.label ?? r.model}</strong>
                    <div className="sub" style={{ marginTop: 2, fontSize: 12 }}>{(r.latency_ms / 1000).toFixed(0)} s · {r.cost_usd == null ? "cost unknown" : `US$${Number(r.cost_usd).toFixed(3)}`}</div>
                  </div>
                  {r.error ? <p className="error" style={{ margin: 0 }}>{r.error}</p> : (
                    <>
                      <div style={{ fontSize: 26, fontWeight: 700 }}>{money(r.total_ex_gst)}<span className="sub" style={{ fontSize: 13 }}> ex GST</span></div>
                      <div style={{ fontSize: 13 }}><strong>{s?.title}</strong><br />{s?.customer_name ?? "No customer"} · {s?.site_location ?? "No site"}</div>
                      <table className="list" style={{ fontSize: 13 }}>
                        <tbody>
                          {(s?.items ?? []).map((it) => (
                            <tr key={it.key}><td style={{ padding: "6px 4px" }}>{it.description}</td><td style={{ padding: "6px 4px", whiteSpace: "nowrap", textAlign: "right" }}>
                              {it.area_m2 != null ? `${it.area_m2} m²` : ""}{it.depth_mm != null ? ` × ${it.depth_mm} mm` : ""}{it.quantity != null ? `${it.quantity}` : ""}</td></tr>
                          ))}
                          {(s?.crew ?? []).map((c) => <tr key={c.key}><td style={{ padding: "6px 4px" }}>Crew</td><td style={{ padding: "6px 4px", textAlign: "right" }}>{c.amount} h × {c.days ?? 1} d</td></tr>)}
                        </tbody>
                      </table>
                      {(s?.questions?.length ?? 0) > 0 && <div style={{ fontSize: 13, background: "var(--warn-bg)", borderRadius: 8, padding: 8 }}><strong>Asks:</strong><ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>{s!.questions.map((q) => <li key={q}>{q}</li>)}</ul></div>}
                      {(s?.assumptions?.length ?? 0) > 0 && <div style={{ fontSize: 13 }}><strong>Assumed:</strong><ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>{s!.assumptions.map((a) => <li key={a}>{a}</li>)}</ul></div>}
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {batches.length > 0 && (
        <section className="card">
          <h2>Earlier tests</h2>
          <ul style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 6 }}>
            {batches.map((b) => <li key={b.batch_id}><Link href={`/admin/ai?batch=${b.batch_id}`} style={{ textDecoration: "underline" }}>{jobLabel(b.tenant_id, b.job_id)}</Link> <span className="sub">{new Date(b.created_at).toLocaleString("en-AU", { dateStyle: "medium", timeStyle: "short" })}</span></li>)}
          </ul>
        </section>
      )}
    </>
  );
}
