"use server";

import { revalidatePath } from "next/cache";
import { requireTenant } from "@/lib/tenant";
import { createClient } from "@/lib/supabase/server";
import { SITE_SCOPE_SCHEMA, cleanScope, scopeFromTalk } from "@/lib/site/scope-ai";
import { aiCaller } from "@/lib/ai/call";
import type { AiKind } from "@/lib/usage";
import { emptyScope, haulFor, loadPricingContext } from "@/lib/site/load";
import { routesToPlants } from "@/lib/site/routes";
import { loadLayeredRules } from "@/lib/rules-load";
import { searchPlaces } from "@/lib/maps";
import { createAdminClient } from "@/lib/supabase/admin";
import { renderTerms } from "@/lib/site/terms";
import { buildXeroQuote, findOrCreateContact, liveXeroQuoteId } from "@/lib/xero";
import { xeroForTenant } from "@/lib/xero-conn";
import { quoteLabel } from "@/lib/quote/numbering";
import { choosePlant, haversineKm, priceSiteQuote, type CustomerLine, type HaulRoutes, type SiteScope } from "@/lib/site/price";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export type ActionResult = { ok: true; id: string } | { ok: false; message: string };

async function writer() {
  const ctx = await requireTenant();
  if (ctx.role === "viewer") throw new Error("Viewers can't create or change quotes.");
  return ctx;
}

function siteCaller(ctx: { tenant: { id: string }; userId: string }, kind: AiKind) {
  return aiCaller(SITE_SCOPE_SCHEMA, ctx.tenant.id, ctx.userId, kind);
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
    const call = await siteCaller(ctx, "ai_quote");
    const title = input.customer ? `${input.customer}${input.address ? `, ${input.address.split(",")[0]}` : ""}` : input.address || "Quote";

    let scope: SiteScope = emptyScope(title);
    if (call && pc.library.some((c) => c.active)) {
      try {
        const out = await scopeFromTalk(call, { tradingName: ctx.tenant.name, library: pc.library, plants: pc.plants, rules: await loadLayeredRules(db, ctx.tenant.id) }, {
          transcript, siteAddress: input.address || null, photoUrls: await signedPhotoUrls(db, photos),
        });
        scope = { ...out.scope, haul_override: null, supply_plant_auto: false };
      } catch (e) {
        scope.questions.push(`The AI couldn't read this one (${e instanceof Error ? e.message : "error"}). Add the items below, or try "Change something".`);
      }
    } else {
      scope.questions.push(!call
        ? "The AI isn't switched on yet (no xAI key on the server), so add the items yourself below."
        : "Your costs library is empty. Add your costs first, then rebuild.");
    }
    if (!scope.title) scope.title = title;

    // They said where the job is: use that over the phone's location (they may be quoting from home).
    let site = { lat: input.lat, lng: input.lng, address: input.address };
    const spoken = scope.site_location?.trim();
    if (spoken && spoken.length >= 3) {
      try {
        const near = input.lat != null && input.lng != null ? { lat: input.lat, lng: input.lng } : null;
        const [hit] = await searchPlaces(spoken, { apiKey: process.env.GOOGLE_MAPS_API_KEY || null, near });
        const far = hit && near ? haversineKm(near.lat, near.lng, hit.lat, hit.lng) > 1 : !!hit;
        if (hit && far) {
          site = { lat: hit.lat, lng: hit.lng, address: hit.address || spoken };
          scope.assumptions.push(`Job location taken from what was said ("${spoken}"), not the phone's location.`);
          const gpsStreet = input.address ? input.address.split(",")[0].trim() : "";
          if (scope.title === title || (gpsStreet && scope.title.includes(gpsStreet))) scope.title = input.customer ? `${input.customer}, ${spoken}` : spoken;
        }
      } catch { /* keep the phone's location */ }
    }

    const { data: quoteNo, error: qErr } = await db.rpc("take_quote_number", { t: ctx.tenant.id });
    if (qErr) return { ok: false, message: `Couldn't get a quote number: ${qErr.message}` };

    const routes = await routesToPlants(site, pc.plants);
    // Nobody named a plant: use the nearest one that sells the mixes.
    if (!scope.supply_plant_id) scope = choosePlant({ scope, library: pc.library, plants: pc.plants, settings: pc.settings, site, routes });
    const priced = priceSiteQuote({ scope, library: pc.library, settings: pc.settings, haul: haulFor(scope, site, pc.plants, pc.settings, routes), marginPercent: pc.defaultMargin });
    const { data, error } = await db.from("site_quotes").insert({
      tenant_id: ctx.tenant.id, quote_no: quoteNo, title: scope.title, customer_name: input.customer || null,
      site_address: site.address || null, site_lat: site.lat, site_lng: site.lng, haul_routes: routes, transcript, photos,
      scope, costing: priced, margin_percent: pc.defaultMargin, total_ex_gst: priced.priceExGst, created_by: ctx.userId,
    }).select("id").single();
    if (error || !data) return { ok: false, message: `Couldn't save: ${error?.message}` };
    revalidatePath("/quotes");
    return { ok: true, id: data.id as string };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Something went wrong." };
  }
}

/** "Change something": apply a spoken or typed correction to the scope with the AI. */
export async function correctSiteScope(input: { id: string; scope: SiteScope; correction: string }): Promise<{ ok: true; scope: SiteScope } | { ok: false; message: string }> {
  try {
    const ctx = await writer();
    const call = await siteCaller(ctx, "ai_change");
    if (!call) return { ok: false, message: "The AI isn't switched on yet (no xAI key on the server). Edit the items directly instead." };
    if (input.correction.trim().length < 3) return { ok: false, message: "Say or type what to change." };
    const db = await createClient();
    const { data: q } = await db.from("site_quotes").select("id, transcript, site_address").eq("id", input.id).eq("tenant_id", ctx.tenant.id).maybeSingle();
    if (!q) return { ok: false, message: "Quote not found." };
    const pc = await loadPricingContext(db, ctx.tenant.id);
    const out = await scopeFromTalk(call, { tradingName: ctx.tenant.name, library: pc.library, plants: pc.plants, rules: await loadLayeredRules(db, ctx.tenant.id) }, {
      transcript: q.transcript ?? "", siteAddress: q.site_address, photoUrls: [], previous: input.scope, correction: input.correction.slice(0, 4000),
    });
    const keepAuto = input.scope.supply_plant_auto && out.scope.supply_plant_id === input.scope.supply_plant_id;
    return { ok: true, scope: { ...out.scope, haul_override: input.scope.haul_override ?? null, supply_plant_auto: !!keepAuto } };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Something went wrong." };
  }
}

/** Add the customer to the company's list (or fill in their email), and return its id. */
async function rememberCustomer(db: Awaited<ReturnType<typeof createClient>>, tenantId: string, name: string, email: string): Promise<string | null> {
  const { data: found } = await db.from("customers").select("id, email").eq("tenant_id", tenantId).ilike("name", name.replace(/[%_\\]/g, "\\$&")).limit(1).maybeSingle();
  if (found) {
    if (email && !found.email) await db.from("customers").update({ email, updated_at: new Date().toISOString() }).eq("tenant_id", tenantId).eq("id", found.id);
    return found.id as string;
  }
  const { data: made } = await db.from("customers").insert({ tenant_id: tenantId, name, email: email || null }).select("id").maybeSingle();
  return (made?.id as string | undefined) ?? null;
}

/** Save the checked scope, margin and customer details; prices on the server too. */
export async function saveSiteQuote(input: {
  id: string; scope: SiteScope; marginPercent: number; customer: string; customerEmail: string; address: string; status?: "draft" | "sent" | "won" | "lost";
  inclusions?: string[]; exclusions?: string[]; showMap?: boolean;
}): Promise<ActionResult> {
  try {
    const ctx = await writer();
    const db = await createClient();
    const { data: q } = await db.from("site_quotes").select("id, site_lat, site_lng, haul_routes, option_group").eq("id", input.id).eq("tenant_id", ctx.tenant.id).maybeSingle();
    if (!q) return { ok: false, message: "Quote not found." };
    const pc = await loadPricingContext(db, ctx.tenant.id);
    const { scope } = cleanScope(input.scope, pc.library, pc.plants, pc.settings.state ?? null);
    scope.supply_plant_auto = !!input.scope.supply_plant_auto;
    scope.questions = input.scope.questions; // keep the user's view of questions, not re-added fixes
    const ho = input.scope.haul_override;
    scope.haul_override = ho && Number.isFinite(ho.km) && Number.isFinite(ho.minutes) && ho.km >= 0 && ho.minutes >= 0 ? ho : null;
    const margin = Math.min(90, Math.max(0, Number(input.marginPercent) || 0));
    const priced = priceSiteQuote({ scope, library: pc.library, settings: pc.settings, haul: haulFor(scope, { lat: q.site_lat, lng: q.site_lng }, pc.plants, pc.settings, q.haul_routes as HaulRoutes | null), marginPercent: margin });
    const { error } = await db.from("site_quotes").update({
      scope, costing: priced, margin_percent: margin, total_ex_gst: priced.priceExGst, title: scope.title,
      customer_name: input.customer.slice(0, 200) || null, customer_email: input.customerEmail.slice(0, 200) || null,
      site_address: input.address.slice(0, 300) || null, ...(input.status ? { status: input.status } : {}), updated_at: new Date().toISOString(),
    }).eq("id", input.id).eq("tenant_id", ctx.tenant.id);
    if (error) return { ok: false, message: error.message };

    // The customer list: remember who this is for.
    const customerName = input.customer.trim().slice(0, 200);
    const customerId = customerName ? await rememberCustomer(db, ctx.tenant.id, customerName, input.customerEmail.trim().slice(0, 200)) : null;

    // Shared by every option of the quote: who it's for, where, and what's in or out.
    const lines = (v: string[] | undefined) => (v ?? []).map((x) => String(x).trim().slice(0, 300)).filter(Boolean).slice(0, 30);
    const shared = {
      customer_name: customerName || null, customer_email: input.customerEmail.slice(0, 200) || null, site_address: input.address.slice(0, 300) || null,
      customer_id: customerId,
      ...(input.inclusions ? { inclusions: lines(input.inclusions) } : {}), ...(input.exclusions ? { exclusions: lines(input.exclusions) } : {}),
      ...(typeof input.showMap === "boolean" ? { show_map: input.showMap } : {}),
    };
    const sharedQ = db.from("site_quotes").update(shared).eq("tenant_id", ctx.tenant.id);
    await (q.option_group ? sharedQ.eq("option_group", q.option_group).is("superseded_at", null) : sharedQ.eq("id", input.id));
    revalidatePath(`/site/${input.id}`);
    revalidatePath("/quotes");
    return { ok: true, id: input.id };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Something went wrong." };
  }
}

/**
 * Set (or change) where the job is, from a map search or the phone's GPS, and work out the
 * road distance to every plant. Returns the routes so the editor can re-price straight away.
 */
export async function locateSite(input: { id: string; lat: number; lng: number; address?: string | null }): Promise<{ ok: true; routes: HaulRoutes | null } | { ok: false; message: string }> {
  try {
    const ctx = await writer();
    if (!UUID.test(input.id)) return { ok: false, message: "Quote not found." };
    const lat = Number(input.lat), lng = Number(input.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return { ok: false, message: "That location isn't valid." };
    const db = await createClient();
    const pc = await loadPricingContext(db, ctx.tenant.id);
    const routes = await routesToPlants({ lat, lng }, pc.plants);
    const { error } = await db.from("site_quotes").update({
      site_lat: lat, site_lng: lng, haul_routes: routes,
      ...(input.address ? { site_address: String(input.address).slice(0, 300) } : {}), updated_at: new Date().toISOString(),
    }).eq("id", input.id).eq("tenant_id", ctx.tenant.id);
    if (error) return { ok: false, message: error.message };
    revalidatePath(`/site/${input.id}`);
    return { ok: true, routes };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Something went wrong." };
  }
}

/**
 * Send the saved quote to the company's Xero as a DRAFT quote (sending it again updates the same one).
 * Nothing goes to the customer: they send it from Xero.
 */
export async function sendToXero(input: { id: string; origin: string }): Promise<{ ok: true; number: string } | { ok: false; message: string }> {
  try {
    const ctx = await writer();
    if (!UUID.test(input.id)) return { ok: false, message: "Quote not found." };
    const db = await createClient();
    const t = ctx.tenant.id;
    const { data: q } = await db.from("site_quotes")
      .select("quote_no, revision, option_label, title, customer_name, customer_email, site_address, costing, created_at, xero_quote_id")
      .eq("id", input.id).eq("tenant_id", t).maybeSingle();
    if (!q) return { ok: false, message: "Quote not found." };
    if (!q.customer_name?.trim()) return { ok: false, message: "Add the customer's name first, then save." };
    const lines = ((q.costing as { customerLines?: CustomerLine[] } | null)?.customerLines ?? []).filter((l) => l.total > 0);
    if (!lines.length) return { ok: false, message: "This quote has no priced lines yet." };

    const admin = createAdminClient();
    const x = await xeroForTenant(admin, t, input.origin);
    if (!x.ok) return { ok: false, message: x.message };
    const { call, connectionId } = x;
    const contactId = await findOrCreateContact(call, q.customer_name, q.customer_email ?? null);
    const { data: s } = await db.from("tenant_settings").select("quote_terms").eq("tenant_id", t).maybeSingle();
    // Deleted in Xero (or made in another organisation)? Make a fresh draft rather than fail.
    const existingId = await liveXeroQuoteId(call, q.xero_quote_id);
    const body = buildXeroQuote({
      contactId, quoteNo: quoteLabel(q), title: q.title ?? "Quote", siteAddress: q.site_address, lines,
      terms: renderTerms(s?.quote_terms, q.created_at), date: new Date(), existingQuoteId: existingId,
    });
    const out = (await call("/Quotes?unitdp=4", { method: existingId ? "POST" : "PUT", body })) as { Quotes?: { QuoteID: string; QuoteNumber: string }[] };
    const made = out.Quotes?.[0];
    if (!made) return { ok: false, message: "Xero didn't return the quote." };
    await db.from("site_quotes").update({ xero_quote_id: made.QuoteID, xero_quote_number: made.QuoteNumber, xero_sent_at: new Date().toISOString() })
      .eq("id", input.id).eq("tenant_id", t);
    await admin.from("connections").update({ last_ok_at: new Date().toISOString(), last_error: null }).eq("id", connectionId);
    revalidatePath(`/site/${input.id}`);
    return { ok: true, number: made.QuoteNumber };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Sending to Xero failed." };
  }
}
