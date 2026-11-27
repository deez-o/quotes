"use server";

import { revalidatePath } from "next/cache";
import { requireTenant } from "@/lib/tenant";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { cleanAreas, type DrawnArea, type Overview } from "@/lib/rfq/overview";
import { gatherRfq, makeOverview } from "@/lib/rfq/draft";
import { emptyScope, haulFor, loadPricingContext } from "@/lib/site/load";
import { priceSiteQuote, type HaulRoutes, type SiteScope } from "@/lib/site/price";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Result<T = object> = ({ ok: true } & T) | { ok: false; message: string };

async function writer() {
  const ctx = await requireTenant();
  if (ctx.role === "viewer") throw new Error("Viewers can't change quotes.");
  return { ctx, db: await createClient() };
}

/** Save the areas drawn on the map (their m² are worked out again on the server). */
export async function saveAreas(input: { id: string; areas: DrawnArea[] }): Promise<Result<{ areas: DrawnArea[] }>> {
  try {
    const { ctx, db } = await writer();
    if (!UUID.test(input.id)) return { ok: false, message: "Quote not found." };
    const { data: q } = await db.from("site_quotes").select("overview").eq("tenant_id", ctx.tenant.id).eq("id", input.id).maybeSingle();
    if (!q) return { ok: false, message: "Quote not found." };
    const areas = cleanAreas(input.areas);
    const overview = { ...((q.overview as Overview | null) ?? { summary: "", specs: [], key_dates: [], conditions: [], exclusions: [], documents: [] }), areas };
    const { error } = await db.from("site_quotes").update({ overview, updated_at: new Date().toISOString() }).eq("tenant_id", ctx.tenant.id).eq("id", input.id);
    if (error) return { ok: false, message: error.message };
    revalidatePath(`/site/${input.id}/overview`);
    return { ok: true, areas };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Couldn't save the areas." };
  }
}

/** Put a measured area into one of the quote's items, and re-price the quote. */
export async function applyAreaToItem(input: { id: string; itemKey: string; m2: number }): Promise<Result<{ total: number }>> {
  try {
    const { ctx, db } = await writer();
    if (!UUID.test(input.id)) return { ok: false, message: "Quote not found." };
    const m2 = Math.round(Number(input.m2));
    if (!Number.isFinite(m2) || m2 <= 0 || m2 > 10_000_000) return { ok: false, message: "That area isn't valid." };
    const { data: q } = await db.from("site_quotes").select("scope, title, margin_percent, site_lat, site_lng, haul_routes").eq("tenant_id", ctx.tenant.id).eq("id", input.id).maybeSingle();
    if (!q) return { ok: false, message: "Quote not found." };
    const scope: SiteScope = { ...emptyScope(q.title ?? "Quote"), ...(q.scope as Partial<SiteScope>) };
    const item = scope.items.find((i) => i.key === input.itemKey);
    if (!item) return { ok: false, message: "Pick an item in the quote." };
    item.area_m2 = m2;
    const pc = await loadPricingContext(db, ctx.tenant.id);
    const priced = priceSiteQuote({ scope, library: pc.library, settings: pc.settings, haul: haulFor(scope, { lat: q.site_lat, lng: q.site_lng }, pc.plants, pc.settings, q.haul_routes as HaulRoutes | null), marginPercent: Number(q.margin_percent) });
    const { error } = await db.from("site_quotes").update({ scope, costing: priced, total_ex_gst: priced.priceExGst, updated_at: new Date().toISOString() }).eq("tenant_id", ctx.tenant.id).eq("id", input.id);
    if (error) return { ok: false, message: error.message };
    revalidatePath(`/site/${input.id}`);
    revalidatePath(`/site/${input.id}/overview`);
    return { ok: true, total: priced.priceExGst };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Couldn't use that area." };
  }
}

/** Read (or re-read) the job's specs: from the RFQ and its files, or from what was said on site. */
export async function buildOverview(input: { id: string }): Promise<Result> {
  try {
    const { ctx, db } = await writer();
    if (!UUID.test(input.id)) return { ok: false, message: "Quote not found." };
    const { data: q } = await db.from("site_quotes").select("job_id, transcript, title, overview, rfq_summary").eq("tenant_id", ctx.tenant.id).eq("id", input.id).maybeSingle();
    if (!q) return { ok: false, message: "Quote not found." };
    let made: Overview | null = null;
    if (q.job_id) {
      const admin = createAdminClient();
      const { data: msgs } = await admin.from("messages").select("from_address, subject, received_at").eq("tenant_id", ctx.tenant.id).eq("job_id", q.job_id).order("received_at");
      const g = await gatherRfq(admin, ctx.tenant.id, q.job_id, q.title, msgs ?? []);
      made = await makeOverview(ctx.tenant.id, {
        from: g.summary.from, subject: g.summary.subject, received: g.summary.received, body: g.rfq.body, attachments: g.attachments,
        extraNotes: g.emails.slice(1).map((e) => `--- Later email from ${e.from ?? "?"} (${e.date ?? "?"}) ---\n${e.body.slice(0, 8000)}`),
      });
    } else if (q.transcript) {
      made = await makeOverview(ctx.tenant.id, { from: "the estimator, on site", subject: q.title ?? "Site quote", received: null, body: q.transcript, attachments: [] });
    } else {
      return { ok: false, message: "There's no RFQ or site talk to read for this quote." };
    }
    if (!made) return { ok: false, message: "The AI couldn't read it just now. Try again in a minute." };
    const overview = { ...made, areas: (q.overview as Overview | null)?.areas ?? [] };
    const { error } = await db.from("site_quotes").update({ overview }).eq("tenant_id", ctx.tenant.id).eq("id", input.id);
    if (error) return { ok: false, message: error.message };
    revalidatePath(`/site/${input.id}/overview`);
    return { ok: true };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Couldn't build the overview." };
  }
}
