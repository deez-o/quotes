import { RfqFiles, type PortalFetch } from "./rfq-files";
import { providerFor } from "@/lib/portal/providers";
import { RereadButton } from "../../quotes/reread";
import { keyFor, liveModel } from "@/lib/ai/call";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireTenant } from "@/lib/tenant";
import { createClient } from "@/lib/supabase/server";
import { emptyScope, loadPricingContext } from "@/lib/site/load";
import { routesToPlants } from "@/lib/site/routes";
import type { HaulRoutes, SiteScope } from "@/lib/site/price";
import { SiteQuoteEditor, type QuoteView, type RfqView } from "./editor";
import { QuoteBar, type QuoteBarView } from "./quote-bar";
import { quoteLabel } from "@/lib/quote/numbering";
import { syncXeroQuotes } from "@/lib/xero-conn";
import type { CompareView } from "./compare";
import { isOwner } from "@/lib/owner";
import { createAdminClient } from "@/lib/supabase/admin";
import { modelInfo } from "@/lib/ai/models";
import { splitSavedEmail, type RfqSummary } from "@/lib/rfq/split";
import type { Overview } from "@/lib/rfq/overview";

export default async function SiteQuotePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireTenant();
  const db = await createClient();
  const { data: q } = await db.from("site_quotes")
    .select("id, quote_no, status, customer_name, customer_email, site_address, site_lat, site_lng, haul_routes, transcript, photos, scope, margin_percent, title, xero_quote_number, job_id, rfq_summary, total_ex_gst, overview, option_group, option_label, revision, superseded_at, sent_at, accepted_at, accepted_name, accepted_po, accepted_note, inclusions, exclusions, show_map, outcome_note, xero_quote_id, portal_fetch")
    .eq("id", id).eq("tenant_id", ctx.tenant.id).maybeSingle();
  if (!q) notFound();

  // Sent to Xero and still open: see whether the customer has accepted or declined it there.
  if (q.xero_quote_id && (q.status === "draft" || q.status === "sent") && !q.superseded_at) {
    const changed = await Promise.race([
      syncXeroQuotes(createAdminClient(), ctx.tenant.id, { ids: [q.id], limit: 1 }).catch(() => 0),
      new Promise<number>((r) => setTimeout(() => r(0), 4000)),
    ]);
    if (changed) {
      const { data: fresh } = await db.from("site_quotes").select("status, accepted_at, accepted_name").eq("id", q.id).eq("tenant_id", ctx.tenant.id).single();
      if (fresh) Object.assign(q, fresh);
    }
  }
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
    areas: ((q.overview as Overview | null)?.areas) ?? [],
    planOverlay: ((q.overview as Overview | null)?.plan_overlay) ?? null,
    inclusions: (q.inclusions as string[] | null) ?? [], exclusions: (q.exclusions as string[] | null) ?? [], show_map: q.show_map !== false,
    rfqExclusions: ((q.overview as Overview | null)?.exclusions) ?? [], rfqConditions: ((q.overview as Overview | null)?.conditions) ?? [],
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

  // Testing (quoteout staff only): other models' drafts of this RFQ.
  let compare: CompareView | null = null;
  if (q.job_id && (await isOwner(ctx.userId))) {
    const admin = createAdminClient();
    const { data: trials } = await admin.from("ai_trials").select("id, batch_id, model, scope, total_ex_gst, questions, cost_usd, latency_ms, error, created_at")
      .eq("tenant_id", ctx.tenant.id).eq("job_id", q.job_id).order("created_at", { ascending: false }).limit(10);
    const latest = trials?.[0]?.batch_id;
    const rows = (trials ?? []).filter((t) => t.batch_id === latest);
    if (rows.length) {
      const cur = q.scope as SiteScope;
      const size = (it: SiteScope["items"][number]) => [it.area_m2 != null ? `${it.area_m2} m²` : "", it.depth_mm != null ? `${it.depth_mm} mm` : "", it.quantity != null ? String(it.quantity) : ""].filter(Boolean).join(" × ");
      compare = {
        current: { label: modelInfo((q.rfq_summary as RfqSummary | null)?.model)?.label ?? "Main model", total: q.total_ex_gst == null ? null : Number(q.total_ex_gst), questions: cur.questions?.length ?? 0, items: cur.items?.length ?? 0 },
        others: rows.map((t) => {
          const sc = t.scope as SiteScope | null;
          return {
            id: t.id, label: modelInfo(t.model)?.label ?? t.model, total: t.total_ex_gst == null ? null : Number(t.total_ex_gst), questions: t.questions ?? 0,
            items: (sc?.items ?? []).map((it) => ({ description: it.description, size: size(it) })),
            asks: sc?.questions ?? [], assumes: sc?.assumptions ?? [], seconds: Math.round((t.latency_ms ?? 0) / 1000),
            costUsd: t.cost_usd == null ? null : Number(t.cost_usd), error: t.error,
          };
        }),
      };
    }
  }

  // Options of this quote, its earlier revisions, and whether the customer has accepted.
  const t = ctx.tenant.id;
  const [{ data: opts }, { data: revs }, { data: customers }] = await Promise.all([
    q.option_group ? db.from("site_quotes").select("id, option_label, title, total_ex_gst, accepted_at, accepted_name, accepted_po, accepted_note").eq("tenant_id", t).eq("option_group", q.option_group).eq("revision", q.revision).order("option_label") : Promise.resolve({ data: null }),
    q.quote_no ? db.from("site_quotes").select("id, revision, option_label, sent_at, superseded_at").eq("tenant_id", t).eq("quote_no", q.quote_no).neq("revision", q.revision).order("revision") : Promise.resolve({ data: null }),
    db.from("customers").select("name, email").eq("tenant_id", t).order("name").limit(500),
  ]);
  const [{ data: idx }, { data: ts }, { data: made }] = await Promise.all([
    db.from("bitumen_indexes").select("month, value").order("month", { ascending: false }).limit(36),
    db.from("tenant_settings").select("binder_percent").eq("tenant_id", t).maybeSingle(),
    db.from("site_quotes").select("created_at").eq("tenant_id", t).eq("id", q.id).single(),
  ]);
  const sameOpt = (r: { option_label: string | null }) => (r.option_label ?? "A") === (q.option_label ?? "A") || !r.option_label;
  const earlier = (revs ?? []).filter((r) => r.revision < q.revision && sameOpt(r));
  const latest = (revs ?? []).filter((r) => r.revision > q.revision && !r.superseded_at && sameOpt(r)).sort((a, b) => b.revision - a.revision)[0];
  const acceptedRow = (opts ?? []).find((o) => o.accepted_at) ?? (q.accepted_at ? { ...q, option_label: null } : null);
  const bar: QuoteBarView = {
    id: q.id, label: quoteLabel(q), status: q.status, canEdit: ctx.role !== "viewer", sentAt: q.sent_at ?? null,
    outcomeNote: q.outcome_note ?? null, xeroNumber: q.xero_quote_number ?? null,
    options: (opts ?? []).map((o) => ({ id: o.id, label: o.option_label ?? "A", title: o.title ?? "", total: o.total_ex_gst == null ? null : Number(o.total_ex_gst) })),
    revisions: earlier.map((r) => ({ id: r.id, label: quoteLabel({ quote_no: q.quote_no, revision: r.revision }), sentAt: r.sent_at })),
    newer: latest ? { id: latest.id, label: quoteLabel({ quote_no: q.quote_no, revision: latest.revision }) } : null,
    accepted: acceptedRow ? { name: acceptedRow.accepted_name, po: acceptedRow.accepted_po, note: acceptedRow.accepted_note, at: acceptedRow.accepted_at!, option: (opts?.length ?? 0) > 1 ? acceptedRow.option_label : null } : null,
  };

  const { data: xero } = await db.from("connections").select("id").eq("tenant_id", ctx.tenant.id).eq("provider", "xero").eq("status", "ok").limit(1).maybeSingle();

  return (
    <div className="page" style={{ maxWidth: 1280 }}>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <Link href="/quotes" className="sub" style={{ marginTop: 0 }}>← Quotes</Link>
        <span className="sub" style={{ marginTop: 0, fontWeight: 600 }}>{quoteLabel(q)} · {q.status}</span>
      </div>
      <QuoteBar v={bar} />
      {q.job_id && !q.sent_at && !q.option_group && !(Number(q.revision) > 0) && !((q.scope as { items?: unknown[] } | null)?.items?.length) && ctx.role !== "viewer" && (
        <div className="card" style={{ background: "var(--warn-bg)", borderColor: "transparent", display: "flex", flexDirection: "column", gap: 8 }}>
          <strong>Nothing has been priced on this RFQ yet.</strong>
          <span className="sub" style={{ marginTop: 0 }}>If it was read before your costs were set up, read it again now and quoteout fills in the items from the RFQ.</span>
          <RereadButton siteQuoteId={q.id} label="Read it again with your costs" />
        </div>
      )}
      {q.job_id && !q.sent_at && !q.option_group && !(Number(q.revision) > 0) && (
        <RfqFiles quoteId={q.id} tenantId={ctx.tenant.id} portal={(q.rfq_summary as RfqSummary | null)?.portal ?? null} canEdit={ctx.role !== "viewer"}
          fetched={(q.portal_fetch as PortalFetch) ?? null}
          linkCount={(q.rfq_summary as RfqSummary | null)?.links?.length ?? (rfq?.emails.some((e) => /sharepoint\.com|1drv\.ms|onedrive\.live|dropbox\.com|drive\.google/i.test(e.body)) ? 1 : 0)}
          hasLogin={Boolean((await createAdminClient().from("connections").select("id").eq("tenant_id", ctx.tenant.id).eq("purpose", "portal").eq("provider", providerFor((q.rfq_summary as RfqSummary | null)?.portal?.portal ?? "") ?? "none").maybeSingle()).data)} />
      )}
      <SiteQuoteEditor quote={view} library={pc.library} plants={pc.plants} settings={pc.settings}
        hasAi={Boolean(keyFor(await liveModel()))} canEdit={ctx.role !== "viewer"} hasXero={!!xero} rfq={rfq} compare={compare} hasSheet
        customers={(customers ?? []).map((c) => ({ name: c.name as string, email: (c.email as string | null) ?? null }))}
        bitumen={{ indexes: (idx ?? []).map((i) => ({ month: i.month as string, value: Number(i.value) })), binderPercent: Number(ts?.binder_percent ?? 5.5), quotedAt: (made?.created_at as string) ?? new Date().toISOString() }} />
    </div>
  );
}
