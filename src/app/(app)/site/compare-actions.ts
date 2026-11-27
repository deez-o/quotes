"use server";

import { revalidatePath } from "next/cache";
import { requireOwner } from "@/lib/owner";
import { loadPricingContext, haulFor } from "@/lib/site/load";
import { priceSiteQuote, type HaulRoutes, type SiteScope } from "@/lib/site/price";
import { modelInfo } from "@/lib/ai/models";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Testing: swap a drafted RFQ quote for another model's version of it, priced the same way.
 * The site, margin and customer stay; the items, crew, plant and questions come from that model.
 */
export async function applyTrialVersion(input: { quoteId: string; trialId: string }): Promise<{ ok: true; message: string } | { ok: false; message: string }> {
  try {
    const { db, userId } = await requireOwner();
    if (!UUID.test(input.quoteId) || !UUID.test(input.trialId)) return { ok: false, message: "Not found." };
    const { data: q } = await db.from("site_quotes").select("id, tenant_id, job_id, site_lat, site_lng, haul_routes, margin_percent, rfq_summary, customer_name, customer_email").eq("id", input.quoteId).maybeSingle();
    const { data: t } = await db.from("ai_trials").select("id, tenant_id, job_id, model, scope").eq("id", input.trialId).maybeSingle();
    if (!q || !t || t.tenant_id !== q.tenant_id || t.job_id !== q.job_id || !t.scope) return { ok: false, message: "That version isn't for this quote." };

    const pc = await loadPricingContext(db, q.tenant_id);
    const scope = t.scope as SiteScope;
    const margin = Number(q.margin_percent);
    const priced = priceSiteQuote({ scope, library: pc.library, settings: pc.settings, haul: haulFor(scope, { lat: q.site_lat, lng: q.site_lng }, pc.plants, pc.settings, q.haul_routes as HaulRoutes | null), marginPercent: margin });
    const summary = { ...(q.rfq_summary as Record<string, unknown> | null), model: t.model };
    const { error } = await db.from("site_quotes").update({
      scope, costing: priced, total_ex_gst: priced.priceExGst, title: scope.title, rfq_summary: summary,
      customer_name: q.customer_name ?? scope.customer_name ?? null, customer_email: q.customer_email ?? scope.customer_email ?? null,
      updated_at: new Date().toISOString(),
    }).eq("id", q.id).eq("tenant_id", q.tenant_id);
    if (error) return { ok: false, message: error.message };
    await db.from("audit_log").insert({ tenant_id: q.tenant_id, actor: userId, action: "quote.use_model_version", target: `${q.id} ${t.model}` });
    revalidatePath(`/site/${q.id}`);
    return { ok: true, message: `Now showing ${modelInfo(t.model)?.label ?? t.model}'s version.` };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Couldn't switch versions." };
  }
}
