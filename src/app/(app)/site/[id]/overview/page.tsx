import Link from "next/link";
import { notFound } from "next/navigation";
import { requireTenant } from "@/lib/tenant";
import { createClient } from "@/lib/supabase/server";
import type { Overview } from "@/lib/rfq/overview";
import type { RfqSummary } from "@/lib/rfq/split";
import type { SiteScope } from "@/lib/site/price";
import { AreaMap } from "./area-map";
import { BuildOverviewButton, StreetViews } from "./parts";

export default async function JobOverviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireTenant();
  const db = await createClient();
  const { data: q } = await db.from("site_quotes")
    .select("id, quote_no, title, customer_name, site_address, site_lat, site_lng, scope, overview, rfq_summary, job_id, transcript, photos")
    .eq("tenant_id", ctx.tenant.id).eq("id", id).maybeSingle();
  if (!q) notFound();

  const ov = (q.overview ?? null) as Overview | null;
  const scope = (q.scope ?? { items: [] }) as SiteScope;
  const canEdit = ctx.role !== "viewer";
  const hasSource = Boolean(q.job_id || q.transcript);
  const items = (scope.items ?? []).filter((i) => i.kind !== "other" || i.area_m2 != null)
    .map((i) => ({ key: i.key, label: i.description || i.kind, area: i.area_m2 }));

  const sum = (q.rfq_summary ?? null) as RfqSummary | null;
  const files: { name: string; url: string | null }[] = [];
  for (const f of sum?.files ?? []) {
    if (!f.path.startsWith(`${ctx.tenant.id}/`)) continue;
    const { data } = await db.storage.from("job-files").createSignedUrl(f.path, 3600);
    files.push({ name: f.name, url: data?.signedUrl ?? null });
  }
  const photos: string[] = [];
  for (const p of (q.photos as string[] | null) ?? []) {
    const { data } = await db.storage.from("job-files").createSignedUrl(p, 3600);
    if (data?.signedUrl) photos.push(data.signedUrl);
  }
  const about = new Map((ov?.documents ?? []).map((d) => [d.name.toLowerCase(), d.about]));
  const located = q.site_lat != null && q.site_lng != null;

  return (
    <div style={{ maxWidth: 1040, margin: "0 auto", display: "grid", gap: 14 }}>
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        <div>
          <Link href={`/site/${q.id}`} className="sub">← Back to the quote</Link>
          <h1 style={{ margin: "4px 0 0" }}>Job overview</h1>
          <div className="sub">{[q.quote_no, q.title, q.customer_name].filter(Boolean).join(" — ")}</div>
          {q.site_address && <div className="sub">{q.site_address}</div>}
        </div>
        <a className="btn" href={`/print/overview/${q.id}`} target="_blank" rel="noreferrer">PDF / print</a>
      </div>

      <section className="card">
        <div className="row" style={{ justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
          <strong>What the job is</strong>
          {canEdit && hasSource && <BuildOverviewButton quoteId={q.id} again={Boolean(ov?.summary)} />}
        </div>
        {ov?.summary ? <p style={{ margin: "8px 0 0" }}>{ov.summary}</p>
          : <p className="sub" style={{ margin: "8px 0 0" }}>{hasSource ? "The specs haven't been read for this quote yet." : "This quote has no RFQ or site talk to read specs from. You can still measure areas on the map."}</p>}
      </section>

      {located ? (
        <AreaMap quoteId={q.id} center={{ lat: q.site_lat!, lng: q.site_lng! }} initial={ov?.areas ?? []} items={items} canEdit={canEdit}
          browserKey={process.env.NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY ?? null} />
      ) : (
        <section className="card"><strong>Measure on the map</strong><p className="sub">Add the site address on the quote first, so the map knows where to look.</p></section>
      )}

      {ov && ov.specs.length > 0 && (
        <section className="card">
          <strong>Specs</strong>
          <div style={{ overflowX: "auto", marginTop: 8 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
              <thead><tr style={{ textAlign: "left" }}><th style={{ padding: "6px 8px" }}>Item</th><th style={{ padding: "6px 8px" }}>Spec</th><th style={{ padding: "6px 8px" }}>From</th></tr></thead>
              <tbody>
                {ov.specs.map((s, i) => (
                  <tr key={i} style={{ borderTop: "1px solid var(--line, #e1e4e8)" }}>
                    <td style={{ padding: "6px 8px", fontWeight: 600 }}>{s.label}</td><td style={{ padding: "6px 8px" }}>{s.value}</td><td style={{ padding: "6px 8px" }} className="sub">{s.source}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {ov && (ov.key_dates.length > 0 || ov.conditions.length > 0 || ov.exclusions.length > 0) && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 14 }}>
          {ov.key_dates.length > 0 && (
            <section className="card"><strong>Dates</strong>
              {ov.key_dates.map((d, i) => <div key={i} style={{ marginTop: 6 }}><span className="sub">{d.label}:</span> {d.value}</div>)}
            </section>
          )}
          {ov.conditions.length > 0 && (
            <section className="card"><strong>Conditions</strong><ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>{ov.conditions.map((c, i) => <li key={i}>{c}</li>)}</ul></section>
          )}
          {ov.exclusions.length > 0 && (
            <section className="card"><strong>By others or excluded</strong><ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>{ov.exclusions.map((c, i) => <li key={i}>{c}</li>)}</ul></section>
          )}
        </div>
      )}

      {located && (
        <section className="card"><strong>The street</strong><div style={{ marginTop: 8 }}><StreetViews quoteId={q.id} /></div></section>
      )}

      {files.length > 0 && (
        <section className="card"><strong>Documents</strong>
          <div style={{ display: "grid", gap: 6, marginTop: 8 }}>
            {files.map((f) => (
              <div key={f.name}>
                {f.url ? <a href={f.url} target="_blank" rel="noreferrer" style={{ fontWeight: 600 }}>{f.name}</a> : <strong>{f.name}</strong>}
                {about.get(f.name.toLowerCase()) && <div className="sub">{about.get(f.name.toLowerCase())}</div>}
              </div>
            ))}
          </div>
        </section>
      )}

      {photos.length > 0 && (
        <section className="card"><strong>Site photos</strong>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 8, marginTop: 8 }}>
            {/* eslint-disable-next-line @next/next/no-img-element -- short-lived signed URLs */}
            {photos.map((u) => <a key={u} href={u} target="_blank" rel="noreferrer"><img src={u} alt="Site photo" style={{ width: "100%", aspectRatio: "1", objectFit: "cover", borderRadius: 8 }} /></a>)}
          </div>
        </section>
      )}
    </div>
  );
}
