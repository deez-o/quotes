import Link from "next/link";
import { notFound } from "next/navigation";
import { requireTenant } from "@/lib/tenant";
import { createClient } from "@/lib/supabase/server";
import { emptyScope, loadPricingContext } from "@/lib/site/load";
import type { SiteScope } from "@/lib/site/price";
import { SiteQuoteEditor, type QuoteView } from "./editor";

export default async function SiteQuotePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireTenant();
  const db = await createClient();
  const { data: q } = await db.from("site_quotes")
    .select("id, quote_no, status, customer_name, customer_email, site_address, site_lat, site_lng, transcript, photos, scope, margin_percent, title")
    .eq("id", id).eq("tenant_id", ctx.tenant.id).maybeSingle();
  if (!q) notFound();

  const pc = await loadPricingContext(db, ctx.tenant.id);
  const photoUrls: string[] = [];
  for (const p of (q.photos as string[]) ?? []) {
    const { data } = await db.storage.from("job-files").createSignedUrl(p, 3600);
    if (data?.signedUrl) photoUrls.push(data.signedUrl);
  }
  const stored = q.scope as Partial<SiteScope>;
  const scope: SiteScope = { ...emptyScope(q.title ?? "Site quote"), ...stored };

  const view: QuoteView = {
    id: q.id, quote_no: q.quote_no, status: q.status, customer_name: q.customer_name, customer_email: q.customer_email,
    site_address: q.site_address, site_lat: q.site_lat, site_lng: q.site_lng, transcript: q.transcript, photoUrls,
    scope, margin_percent: Number(q.margin_percent),
  };

  return (
    <div className="page" style={{ maxWidth: 720 }}>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <Link href="/site" className="sub" style={{ marginTop: 0 }}>← Site quotes</Link>
        <span className="sub" style={{ marginTop: 0, fontWeight: 600 }}>{q.quote_no} · {q.status}</span>
      </div>
      <SiteQuoteEditor quote={view} library={pc.library} plants={pc.plants} settings={pc.settings}
        hasAi={Boolean(process.env.XAI_API_KEY)} canEdit={ctx.role !== "viewer"} />
    </div>
  );
}
