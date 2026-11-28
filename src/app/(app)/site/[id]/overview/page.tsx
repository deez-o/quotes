import Link from "next/link";
import { notFound } from "next/navigation";
import { requireTenant } from "@/lib/tenant";
import { createClient } from "@/lib/supabase/server";
import type { Overview } from "@/lib/rfq/overview";
import type { RfqSummary } from "@/lib/rfq/split";
import type { SiteScope } from "@/lib/site/price";
import { AreaMap } from "./area-map";
import { tidyItems } from "@/lib/site/tidy";
import { fillAddedMixes } from "@/lib/site/fill-mixes";
import { yardRoute } from "@/lib/site/yard-route";
import { cleanCrewOutput } from "@/lib/site/crew-days";
import type { CostItem } from "@/lib/site/price";
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
  // What's being quoted, straight from the quote, so the overview is never blank.
  // Their mixes, so a mix they've added since the RFQ was read (e.g. EME2) shows as the product.
  const { data: costs } = await db.from("cost_items").select("id, name, category, material_kind, unit, rate, density_t_per_m3, active").eq("tenant_id", ctx.tenant.id).eq("active", true);
  const filled = fillAddedMixes({ ...scope, items: scope.items ?? [], crew: scope.crew ?? [], questions: scope.questions ?? [] }, (costs ?? []) as CostItem[]);
  const costOf = new Map((costs ?? []).map((c) => [c.id as string, c as { name: string; density_t_per_m3: number | null }]));
  const quoted = tidyItems(filled.items).map((i) => {
    const c = i.cost_item_id ? costOf.get(i.cost_item_id) : undefined;
    const d = c?.density_t_per_m3 ?? (i.kind === "asphalt" ? 2.4 : null);
    const t = (i.kind === "asphalt" || i.kind === "base") && d && i.area_m2 && i.depth_mm ? i.area_m2 * (i.depth_mm / 1000) * d : null;
    return { key: i.key, what: i.description || i.kind, product: c?.name ?? null, depth: i.depth_mm, area: i.area_m2, qty: i.quantity, tonnes: t };
  });
  const notes = ((scope as { assumptions?: string[] }).assumptions ?? []).filter(Boolean);
  const n0 = (v: number) => v.toLocaleString("en-AU", { maximumFractionDigits: 0 });
  const about = new Map((ov?.documents ?? []).map((d) => [d.name.toLowerCase(), d.about]));
  const located = q.site_lat != null && q.site_lng != null;
  // Their yard to the job: distance and travel time (crew output drops on long hauls).
  const { data: ts } = await db.from("tenant_settings").select("base_lat, base_lng, crew_output").eq("tenant_id", ctx.tenant.id).maybeSingle();
  const hasYard = ts?.base_lat != null && ts?.base_lng != null;
  const yard = hasYard && located ? await yardRoute({ lat: Number(ts!.base_lat), lng: Number(ts!.base_lng) }, { lat: q.site_lat!, lng: q.site_lng! }) : null;
  const farMinutes = cleanCrewOutput(ts?.crew_output ?? null).farMinutes;

  return (
    <div style={{ maxWidth: 1040, margin: "0 auto", display: "grid", gap: 14 }}>
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        <div>
          <Link href={`/site/${q.id}`} className="btn back-btn">← Back to the quote</Link>
          <h1 style={{ margin: "4px 0 0" }}>Job overview</h1>
          <div className="sub">{[q.quote_no, q.title, q.customer_name].filter(Boolean).join(" — ")}</div>
          {q.site_address && <div className="sub">{q.site_address}</div>}
        </div>
        <div className="row" style={{ gap: 8 }}>
          <a className="btn" href={`/print/overview/${q.id}`} target="_blank" rel="noreferrer">PDF / print</a>
          <a className="btn" href={`/api/quotes/${q.id}/pack`} download>Download job folder</a>
        </div>
      </div>

      <section className="card">
        <div className="row" style={{ justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
          <strong>What the job is</strong>
          {canEdit && hasSource && <BuildOverviewButton quoteId={q.id} again={Boolean(ov?.summary)} />}
        </div>
        {ov?.summary ? <p style={{ margin: "8px 0 0" }}>{ov.summary}</p>
          : <p className="sub" style={{ margin: "8px 0 0" }}>{hasSource ? "The documents haven't been read for this quote yet. Below is what's on the quote." : "No RFQ documents on this quote. Below is what's on the quote."}</p>}
        {quoted.length > 0 && (
          <div style={{ overflowX: "auto", marginTop: 12 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
              <thead><tr style={{ textAlign: "left" }} className="sub"><th style={{ padding: "6px 8px" }}>Work</th><th style={{ padding: "6px 8px" }}>Product</th><th style={{ padding: "6px 8px", textAlign: "right" }}>Depth</th><th style={{ padding: "6px 8px", textAlign: "right" }}>Area</th><th style={{ padding: "6px 8px", textAlign: "right" }}>Tonnes</th></tr></thead>
              <tbody>
                {quoted.map((r) => (
                  <tr key={r.key} style={{ borderTop: "1px solid var(--line, #e1e4e8)" }}>
                    <td style={{ padding: "8px", fontWeight: 600 }}>{r.what}</td>
                    <td style={{ padding: "8px" }}>{r.product ?? "—"}</td>
                    <td style={{ padding: "8px", textAlign: "right" }}>{r.depth ? `${r.depth} mm` : "—"}</td>
                    <td style={{ padding: "8px", textAlign: "right" }}>{r.area ? `${n0(r.area)} m²` : r.qty ? n0(r.qty) : "—"}</td>
                    <td style={{ padding: "8px", textAlign: "right" }}>{r.tonnes ? `${n0(r.tonnes)} t` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {notes.length > 0 && (
          <details open style={{ marginTop: 12 }}>
            <summary style={{ cursor: "pointer", fontWeight: 600 }}>What quoteout assumed ({notes.length})</summary>
            <ul style={{ margin: "6px 0 0", paddingLeft: 18, display: "grid", gap: 4 }}>{notes.map((a, i) => <li key={i}>{a.replace(/\s*Source:\s*(house|own|company)\.?/gi, "")}</li>)}</ul>
          </details>
        )}
      </section>

      {located && (
        <section className="card">
          <strong>From your yard</strong>
          {yard ? (
            <p style={{ margin: "6px 0 10px", fontSize: 18 }}>
              <strong>{yard.km.toLocaleString("en-AU")} km</strong>, about <strong>{yard.truckMinutes} min</strong> one way for a loaded truck
              <span className="sub" style={{ marginTop: 0, fontSize: 13 }}> ({yard.carMinutes} min by car){yard.truckMinutes > farMinutes ? ` · long haul (over ${farMinutes} min): less laid a shift` : ""}</span>
            </p>
          ) : (
            <p className="sub" style={{ margin: "6px 0 10px" }}>{hasYard ? "Couldn't work out the road route right now." : <>Add your yard or depot address in <Link href="/setup">Setup</Link> to see the distance and travel time to each job.</>}</p>
          )}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 10 }}>
            {/* eslint-disable-next-line @next/next/no-img-element -- served by our own route (keeps the maps key private) */}
            {hasYard && <img src={`/api/quotes/${q.id}/route-map?view=route`} alt="Route from your yard to the job" style={{ width: "100%", borderRadius: 8, border: "1px solid var(--line)" }} />}
            {/* eslint-disable-next-line @next/next/no-img-element -- as above */}
            <img src={`/api/quotes/${q.id}/route-map?view=site`} alt="The job site, close up" style={{ width: "100%", borderRadius: 8, border: "1px solid var(--line)" }} />
          </div>
        </section>
      )}

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
