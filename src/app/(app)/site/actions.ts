"use server";

import { revalidatePath } from "next/cache";
import { requireTenant } from "@/lib/tenant";
import { createClient } from "@/lib/supabase/server";
import { SITE_SCOPE_SCHEMA, cleanScope, scopeFromTalk } from "@/lib/site/scope-ai";
import { xaiStructured } from "@/lib/quote/provider";
import { emptyScope, haulFor, loadPricingContext } from "@/lib/site/load";
import { priceSiteQuote, type SiteScope } from "@/lib/site/price";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export type ActionResult = { ok: true; id: string } | { ok: false; message: string };

async function writer() {
  const ctx = await requireTenant();
  if (ctx.role === "viewer") throw new Error("Viewers can't create or change quotes.");
  return ctx;
}

function aiCaller() {
  const key = process.env.XAI_API_KEY;
  if (!key) return null;
  const model = process.env.XAI_MODEL ?? "grok-4.3";
  return (messages: Parameters<typeof xaiStructured>[0]["messages"]) =>
    xaiStructured({ apiKey: key, model, schema: SITE_SCOPE_SCHEMA, messages });
}

async function signedPhotoUrls(db: Awaited<ReturnType<typeof createClient>>, paths: string[]) {
  const urls: string[] = [];
  for (const p of paths.slice(0, 6)) {
    const { data } = await db.storage.from("job-files").createSignedUrl(p, 600);
    if (data?.signedUrl) urls.push(data.signedUrl);
  }
  return urls;
}

/** Create a site quote from what was said on site (and photos). */
export async function buildSiteQuote(input: {
  draftId: string; transcript: string; photoPaths: string[];
  lat: number | null; lng: number | null; address: string; customer: string;
}): Promise<ActionResult> {
  try {
    const ctx = await writer();
    if (!UUID.test(input.draftId)) return { ok: false, message: "Something went wrong with this draft. Refresh and try again." };
    const transcript = String(input.transcript ?? "").slice(0, 20_000);
    const photos = input.photoPaths.filter((p) => p.startsWith(`${ctx.tenant.id}/uploads/site-${input.draftId}/`)).slice(0, 12);
    if (transcript.trim().length < 5 && photos.length === 0) return { ok: false, message: "Tell me about the job first (tap the mic), or add photos." };

    const db = await createClient();
    const pc = await loadPricingContext(db, ctx.tenant.id);
    const call = aiCaller();
    const title = input.customer ? `${input.customer}${input.address ? `, ${input.address.split(",")[0]}` : ""}` : input.address || "Site quote";

    let scope: SiteScope = emptyScope(title);
    if (call && pc.library.some((c) => c.active)) {
      try {
        const out = await scopeFromTalk(call, { tradingName: ctx.tenant.name, library: pc.library, plants: pc.plants }, {
          transcript, siteAddress: input.address || null, photoUrls: await signedPhotoUrls(db, photos),
        });
        scope = { ...out.scope, haul_override: null };
      } catch (e) {
        scope.questions.push(`The AI couldn't read this one (${e instanceof Error ? e.message : "error"}). Add the items below, or try "Change something".`);
      }
    } else {
      scope.questions.push(!call
        ? "The AI isn't switched on yet (no xAI key on the server), so add the items yourself below."
        : "Your costs library is empty. Add your costs first, then rebuild.");
    }
    if (!scope.title) scope.title = title;

    const { data: quoteNo, error: qErr } = await db.rpc("take_quote_number", { t: ctx.tenant.id });
    if (qErr) return { ok: false, message: `Couldn't get a quote number: ${qErr.message}` };

    const priced = priceSiteQuote({ scope, library: pc.library, settings: pc.settings, haul: haulFor(scope, input, pc.plants, pc.settings), marginPercent: pc.defaultMargin });
    const { data, error } = await db.from("site_quotes").insert({
      tenant_id: ctx.tenant.id, quote_no: quoteNo, title: scope.title, customer_name: input.customer || null,
      site_address: input.address || null, site_lat: input.lat, site_lng: input.lng, transcript, photos,
      scope, costing: priced, margin_percent: pc.defaultMargin, total_ex_gst: priced.priceExGst, created_by: ctx.userId,
    }).select("id").single();
    if (error || !data) return { ok: false, message: `Couldn't save: ${error?.message}` };
    revalidatePath("/site");
    return { ok: true, id: data.id as string };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Something went wrong." };
  }
}

/** "Change something": apply a spoken or typed correction to the scope with the AI. */
export async function correctSiteScope(input: { id: string; scope: SiteScope; correction: string }): Promise<{ ok: true; scope: SiteScope } | { ok: false; message: string }> {
  try {
    const ctx = await writer();
    const call = aiCaller();
    if (!call) return { ok: false, message: "The AI isn't switched on yet (no xAI key on the server). Edit the items directly instead." };
    if (input.correction.trim().length < 3) return { ok: false, message: "Say or type what to change." };
    const db = await createClient();
    const { data: q } = await db.from("site_quotes").select("id, transcript, site_address").eq("id", input.id).eq("tenant_id", ctx.tenant.id).maybeSingle();
    if (!q) return { ok: false, message: "Quote not found." };
    const pc = await loadPricingContext(db, ctx.tenant.id);
    const out = await scopeFromTalk(call, { tradingName: ctx.tenant.name, library: pc.library, plants: pc.plants }, {
      transcript: q.transcript ?? "", siteAddress: q.site_address, photoUrls: [], previous: input.scope, correction: input.correction.slice(0, 4000),
    });
    return { ok: true, scope: { ...out.scope, haul_override: input.scope.haul_override ?? null } };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Something went wrong." };
  }
}

/** Save the checked scope, margin and customer details; prices on the server too. */
export async function saveSiteQuote(input: {
  id: string; scope: SiteScope; marginPercent: number; customer: string; customerEmail: string; address: string; status?: "draft" | "sent" | "won" | "lost";
}): Promise<ActionResult> {
  try {
    const ctx = await writer();
    const db = await createClient();
    const { data: q } = await db.from("site_quotes").select("id, site_lat, site_lng").eq("id", input.id).eq("tenant_id", ctx.tenant.id).maybeSingle();
    if (!q) return { ok: false, message: "Quote not found." };
    const pc = await loadPricingContext(db, ctx.tenant.id);
    const { scope } = cleanScope(input.scope, pc.library, pc.plants);
    scope.questions = input.scope.questions; // keep the user's view of questions, not re-added fixes
    const ho = input.scope.haul_override;
    scope.haul_override = ho && Number.isFinite(ho.km) && Number.isFinite(ho.minutes) && ho.km >= 0 && ho.minutes >= 0 ? ho : null;
    const margin = Math.min(90, Math.max(0, Number(input.marginPercent) || 0));
    const priced = priceSiteQuote({ scope, library: pc.library, settings: pc.settings, haul: haulFor(scope, { lat: q.site_lat, lng: q.site_lng }, pc.plants, pc.settings), marginPercent: margin });
    const { error } = await db.from("site_quotes").update({
      scope, costing: priced, margin_percent: margin, total_ex_gst: priced.priceExGst, title: scope.title,
      customer_name: input.customer.slice(0, 200) || null, customer_email: input.customerEmail.slice(0, 200) || null,
      site_address: input.address.slice(0, 300) || null, ...(input.status ? { status: input.status } : {}), updated_at: new Date().toISOString(),
    }).eq("id", input.id).eq("tenant_id", ctx.tenant.id);
    if (error) return { ok: false, message: error.message };
    revalidatePath(`/site/${input.id}`);
    revalidatePath("/site");
    return { ok: true, id: input.id };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Something went wrong." };
  }
}
