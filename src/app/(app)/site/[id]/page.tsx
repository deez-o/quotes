import { keyFor, liveModel } from "@/lib/ai/call";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireTenant } from "@/lib/tenant";
import { createClient } from "@/lib/supabase/server";
import { emptyScope, loadPricingContext } from "@/lib/site/load";
import { routesToPlants } from "@/lib/site/routes";
import type { HaulRoutes, SiteScope } from "@/lib/site/price";
import { SiteQuoteEditor, type QuoteView, type RfqView } from "./editor";
import { splitSavedEmail, type RfqSummary } from "@/lib/rfq/split";

export default async function SiteQuotePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireTenant();
  const db = await createClient();
  const { data: q } = await db.from("site_quotes")
    .select("id, quote_no, status, customer_name, customer_email, site_address, site_lat, site_lng, haul_routes, transcript, photos, scope, margin_percent, title, xero_quote_number, job_id, rfq_summary")
    .eq("id", id).eq("tenant_id", ctx.tenant.id).maybeSingle();
  if (!q) notFound();

  const pc = await loadPricingContext(db, ctx.tenant.id);
  const photoUrls: string[] = [];
  for (const p of (q.photos as string[]) ?? []) {
    const { data } = await db.storage.from("job-files").createSignedUrl(p, 3600);
    if (data?.signedUrl) photoUrls.push(data.signedUrl);
  }
  // Quotes made before road routing: work the routes out once and keep them.
  let routes = (q.haul_routes as HaulRoutes | null) ?? null;
  if (!routes && q.site_lat != null && q.site_lng != null && pc.plants.length && ctx.role !== "viewer") {
    routes = await routesToPlants({ lat: q.site_lat, lng: q.site_lng }, pc.plants);
    if (routes) await db.from("site_quotes").update({ haul_routes: routes }).eq("id", q.id).eq("tenant_id", ctx.tenant.id);
  }
  const stored = q.scope as Partial<SiteScope>;
  const scope: SiteScope = { ...emptyScope(q.title ?? "Quote"), ...stored };

  const view: QuoteView = {
    id: q.id, quote_no: q.quote_no, status: q.status, customer_name: q.customer_name, customer_email: q.customer_email,
    site_address: q.site_address, site_lat: q.site_lat, site_lng: q.site_lng, haul_routes: routes, transcript: q.transcript, photoUrls,
    scope, margin_percent: Number(q.margin_percent), xero_quote_number: q.xero_quote_number ?? null,
  };

  // Made from an RFQ: show the original email and files beside the quote.
  let rfq: RfqView | null = null;
  if (q.job_id) {
    const sum = (q.rfq_summary ?? null) as RfqSummary | null;
    const folder = `${ctx.tenant.id}/${q.job_id}/4. Correspondence`;
    const { data: corr } = await db.storage.from("job-files").list(folder, { limit: 20 });
    const emails: RfqView["emails"] = [];
    for (const f of (corr ?? []).filter((x) => x.name && !x.name.startsWith("."))) {
      const { data } = await db.storage.from("job-files").download(`${folder}/${f.name}`);
      if (!data) continue;
      const e = splitSavedEmail(await data.text());
      emails.push({ name: f.name, from: e.from, date: e.date, subject: e.subject, body: e.body.slice(0, 20_000) });
    }
    emails.sort((a, b) => (a.name.startsWith("RFQ") ? -1 : b.name.startsWith("RFQ") ? 1 : String(a.date).localeCompare(String(b.date))));
    const files: RfqView["files"] = [];
    for (const f of sum?.files ?? []) {
      if (!f.path.startsWith(`${ctx.tenant.id}/`)) continue;
      const { data } = await db.storage.from("job-files").createSignedUrl(f.path, 3600);
      files.push({ name: f.name, url: data?.signedUrl ?? null, read: f.read, note: f.note });
    }
    rfq = { from: sum?.from ?? emails[0]?.from ?? null, subject: sum?.subject ?? emails[0]?.subject ?? null, received: sum?.received ?? emails[0]?.date ?? null, emails, files };
  }

  const { data: xero } = await db.from("connections").select("id").eq("tenant_id", ctx.tenant.id).eq("provider", "xero").eq("status", "ok").limit(1).maybeSingle();

  return (
    <div className="page" style={{ maxWidth: 1280 }}>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <Link href="/quotes" className="sub" style={{ marginTop: 0 }}>← Quotes</Link>
        <span className="sub" style={{ marginTop: 0, fontWeight: 600 }}>{q.quote_no} · {q.status}</span>
      </div>
      <SiteQuoteEditor quote={view} library={pc.library} plants={pc.plants} settings={pc.settings}
        hasAi={Boolean(keyFor(await liveModel()))} canEdit={ctx.role !== "viewer"} hasXero={!!xero} rfq={rfq} />
    </div>
  );
}
