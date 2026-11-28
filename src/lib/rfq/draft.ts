import "server-only";
import { missingPictures } from "@/lib/mail/sort";
import type { SupabaseClient } from "@supabase/supabase-js";
import { aiCaller, compareModels, liveModel, liveModelReadsPdfs } from "@/lib/ai/call";
import { runTrials } from "./trial";
import { cleanOverview, OVERVIEW_SCHEMA, overviewMessages, type Overview } from "./overview";
import { buildRfqUserMessage } from "@/lib/site/scope-ai";
import { loadAccess } from "@/lib/access-load";
import { loadPricingContext, emptyScope, haulFor } from "@/lib/site/load";
import { loadLayeredRules } from "@/lib/rules-load";
import { routesToPlants } from "@/lib/site/routes";
import { searchPlaces } from "@/lib/maps";
import { choosePlant, priceSiteQuote, type SiteScope } from "@/lib/site/price";
import { SITE_SCOPE_SCHEMA, scopeFromRfq, type RfqAttachment, type ScopeCall } from "@/lib/site/scope-ai";
import { readFile } from "./read";
import { cleanSubject, forwardedFrom, splitSavedEmail, type RfqSummary } from "./split";
import { detectPortal } from "./portal";
import { findDocLinks } from "./links";
export { splitSavedEmail, type RfqSummary };

const BUCKET = "job-files";
const MAX_FILES = 20;
const MAX_FILE_BYTES = 25 * 1024 * 1024;


export type DraftOutcome =
  | { kind: "drafted"; siteQuoteId: string; questions: number }
  | { kind: "follow_up"; siteQuoteId: string }
  | { kind: "skipped"; reason: string };


export function confidenceFor(questions: number, unreadFiles: number): "high" | "medium" | "low" {
  if (questions === 0 && unreadFiles === 0) return "high";
  if (questions <= 3 && unreadFiles <= 1) return "medium";
  return "low";
}

async function download(db: SupabaseClient, path: string) {
  const { data, error } = await db.storage.from(BUCKET).download(path);
  if (error || !data) throw new Error(`Couldn't open ${path}: ${error?.message ?? "missing"}`);
  return new Uint8Array(await data.arrayBuffer());
}


/**
 * An RFQ job (forwarded, imported or from the inbox) -> an editable, priced draft quote.
 * The estimator always gets a quote to work on: if the AI can't read it, the quote is
 * empty with a note saying why. A later email in the same thread doesn't redo the quote
 * (it may have been edited); it's flagged on the quote instead.
 * Runs in the worker with the service role, so every query names the tenant.
 */
export async function draftRfqQuote(db: SupabaseClient, tenantId: string, jobId: string, opts: { call?: ScopeCall | null; readsPdfs?: boolean; redo?: boolean; portalFetch?: Record<string, unknown> | null } = {}): Promise<DraftOutcome> {
  const { data: job } = await db.from("jobs").select("id, quote_no, status, source, site").eq("tenant_id", tenantId).eq("id", jobId).maybeSingle();
  if (!job) return { kind: "skipped", reason: "job not found" };

  const { data: messages } = await db.from("messages").select("from_address, subject, received_at")
    .eq("tenant_id", tenantId).eq("job_id", jobId).order("received_at", { ascending: true });

  // Already drafted: a follow-up email in the thread. Flag it rather than overwrite their edits.
  let { data: existing } = await db.from("site_quotes").select("id, scope, rfq_summary, sent_at, option_group, revision").eq("tenant_id", tenantId).eq("job_id", jobId).maybeSingle();
  // Read again (e.g. the costs weren't in yet): only a draft nobody has sent or turned into options/revisions.
  // Redone in place, so the quote keeps its address and an open page doesn't break.
  let redoId: string | null = null;
  if (existing && opts.redo && !existing.sent_at && !existing.option_group && !(Number(existing.revision) > 0)) {
    redoId = existing.id as string;
    existing = null;
  }
  if (existing) {
    const scope = existing.scope as SiteScope;
    const n = (messages?.length ?? 1) - 1;
    const note = `Another email came in on this RFQ (${n} follow-up${n === 1 ? "" : "s"} now). Read it under "From the RFQ" and update the quote if it changes anything.`;
    if (!scope.questions.includes(note)) scope.questions = [...scope.questions.filter((q) => !q.startsWith("Another email came in on this RFQ")), note];
    await db.from("site_quotes").update({ scope, rfq_summary: { ...(existing.rfq_summary as RfqSummary), followUps: n }, updated_at: new Date().toISOString() })
      .eq("tenant_id", tenantId).eq("id", existing.id);
    await db.from("jobs").update({ status: "drafted", updated_at: new Date().toISOString() }).eq("tenant_id", tenantId).eq("id", jobId);
    return { kind: "follow_up", siteQuoteId: existing.id as string };
  }

  const g = await gatherRfq(db, tenantId, jobId, job.site, messages ?? []);
  const { summary, rfq, emails, attachments, summaryFiles } = g;

  const [{ data: tenant }, pc, rules, { access }] = await Promise.all([
    db.from("tenants").select("name").eq("id", tenantId).single(),
    loadPricingContext(db, tenantId),
    loadLayeredRules(db, tenantId),
    loadAccess(tenantId),
  ]);

  const fallbackTitle = cleanSubject(summary.subject || "RFQ").slice(0, 120) || "RFQ";
  let scope: SiteScope = emptyScope(fallbackTitle);
  const call = opts.call === undefined ? await aiCaller(SITE_SCOPE_SCHEMA, tenantId, null, "ai_rfq") : opts.call;
  const mainModel = await liveModel();
  // Testing: other models draft the same RFQ alongside, for comparing on the quote page.
  const others = opts.call === undefined && access.state !== "locked" ? await compareModels() : [];
  const shadow = others.length ? runTrials(db, tenantId, jobId, others).catch(() => []) : null;
  const readsPdfs = opts.readsPdfs ?? (await liveModelReadsPdfs());

  let overviewPromise: Promise<Overview | null> = Promise.resolve(null);
  if (access.state === "locked") {
    scope.questions.push(`${access.message} This RFQ was filed but not read.`);
  } else if (!call) {
    scope.questions.push("The AI isn't switched on yet, so add the items from the RFQ yourself.");
  } else if (!pc.library.some((c) => c.active)) {
    scope.questions.push("Your costs library is empty. Add your costs in Setup, then add the items from the RFQ.");
    // Still read the job details (dates, specs, site) for the overview.
    if (opts.call === undefined) overviewPromise = makeOverview(tenantId, {
      from: summary.from, subject: summary.subject, received: summary.received, body: rfq.body, attachments, extraNotes: [],
    });
  } else {
    const rfqInput = {
      from: summary.forwardedBy ? `${summary.from} (forwarded by ${summary.forwardedBy}, who is the contractor, not the customer)` : summary.from,
      subject: summary.subject, received: summary.received, body: rfq.body, attachments,
      extraNotes: emails.slice(1).map((e) => `--- Later email from ${e.from ?? "?"} (${e.date ?? "?"}) ---\n${e.body.slice(0, 8000)}`),
    };
    // The job overview (specs, dates, conditions) is read alongside the scope.
    overviewPromise = opts.call === undefined ? makeOverview(tenantId, rfqInput) : Promise.resolve(null);
    try {
      const out = await scopeFromRfq(call, { tradingName: tenant?.name ?? "the contractor", library: pc.library, plants: pc.plants, rules }, rfqInput);
      scope = { ...out.scope, haul_override: null, supply_plant_auto: false };
    } catch (e) {
      scope.questions.push(`The AI couldn't read this RFQ (${e instanceof Error ? e.message : "error"}). Add the items yourself from the email and files below.`);
    }
  }
  for (const f of summaryFiles.filter((x) => x.read === "no" && !(readsPdfs && x.note?.startsWith("scanned PDF")))) {
    scope.questions.push(`"${f.name}" couldn't be read (${f.note ?? "unknown"}). Check it for anything to price.`);
  }
  if (!scope.title) scope.title = fallbackTitle;
  // The email points at a picture (e.g. "Areas = [image001.png]") that didn't come with it: usually
  // a forward sent as plain text. Say so first, because that picture is often the areas.
  const missing = missingPictures([rfq.body, ...emails.map((e) => e.body)].join("\n"), summaryFiles.map((f) => f.name));
  if (missing.length) {
    const ask = `The email points to a picture (${missing.slice(0, 3).join(", ")}) that didn't come through with it, often the areas or quantities. Forward the original email again, or add the picture under "Add the documents".`;
    if (!scope.questions.includes(ask)) scope.questions.unshift(ask);
  }
  // A portal invite: the customer is the builder inviting, not the portal's mail address.
  const portal = summary.portal;
  if (portal) {
    const fromPortal = (e: string | null | undefined) => !e || /estimateone|tenderlink|buildingconnected|procore|aconex|noreply|no-reply|docs@/i.test(e);
    if (portal.builder && (!scope.customer_name || /estimateone|tenderlink|procore|aconex/i.test(scope.customer_name))) scope.customer_name = portal.builder;
    if (fromPortal(scope.customer_email)) scope.customer_email = portal.contactEmail;
    if (portal.project && (!scope.title || /invitation to tender/i.test(scope.title))) scope.title = `${portal.builder ? `${portal.builder}, ` : ""}${portal.project}`.slice(0, 120);
    const ask = `The drawings and specs are on ${portal.portal}${portal.due ? ` (due ${portal.due})` : ""}. Open the documents, download them, and add them to this quote so they can be read.`;
    if (!scope.questions.includes(ask)) scope.questions.unshift(ask);
  }
  // Who to quote: the original sender of a forwarded RFQ, unless the AI found better.
  const orig = portal ? null : summary.original;
  if (orig) {
    if (!scope.customer_email && orig.email) scope.customer_email = orig.email;
    if (!scope.customer_name) scope.customer_name = orig.name ?? companyFromEmail(orig.email);
  }

  const placed = await locateAndPrice(pc, scope);
  scope = placed.scope;
  const { site, routes, priced } = placed;

  const overview = await overviewPromise;
  const row = {
    tenant_id: tenantId, job_id: jobId, quote_no: job.quote_no, title: scope.title,
    customer_name: scope.customer_name ?? null, customer_email: scope.customer_email ?? null,
    site_address: site.address || null, site_lat: site.lat, site_lng: site.lng, haul_routes: routes,
    transcript: null, photos: [], scope, costing: priced, margin_percent: pc.defaultMargin, total_ex_gst: priced.priceExGst,
    created_by: null, rfq_summary: { ...summary, model: opts.call === undefined ? mainModel : null },
    overview, exclusions: (overview?.exclusions ?? []).slice(0, 30), portal_fetch: opts.portalFetch ?? null,
  };
  const { data: made, error } = redoId
    ? await db.from("site_quotes").update({ ...row, updated_at: new Date().toISOString() }).eq("tenant_id", tenantId).eq("id", redoId).select("id").single()
    : await db.from("site_quotes").insert(row).select("id").single();
  if (error || !made) throw new Error(`Couldn't save the draft quote: ${error?.message}`);

  // A tender portal invite: fetch the documents with the saved login (once per RFQ automatically).
  // Or documents behind SharePoint / Dropbox / Drive links: fetch those (once automatically).
  if ((summary.portal?.docsUrl || summary.links?.length) && !opts.portalFetch && opts.call === undefined) {
    await db.from("queue_jobs").upsert(
      { tenant_id: tenantId, kind: "portal_fetch", payload: { job_id: jobId }, dedupe_key: `portal:${jobId}` },
      { onConflict: "tenant_id,dedupe_key", ignoreDuplicates: true },
    );
  }
  const unread = summaryFiles.filter((f) => f.read === "no").length;
  await db.from("jobs").update({
    status: "drafted", customer_name: scope.customer_name ?? null, site: scope.title.slice(0, 200),
    job_type: scope.job_type || null, confidence: confidenceFor(scope.questions.length, unread), flag_count: scope.questions.length,
    updated_at: new Date().toISOString(),
  }).eq("tenant_id", tenantId).eq("id", jobId);
  await db.from("audit_log").insert({ tenant_id: tenantId, action: "job.drafted", target: job.quote_no, detail: { site_quote_id: made.id, questions: scope.questions.length, files: summaryFiles.length } });

  if (shadow) {
    const results = await shadow;
    const batch = crypto.randomUUID();
    if (results.length) await db.from("ai_trials").insert(results.map((r) => ({
      batch_id: batch, tenant_id: tenantId, job_id: jobId, model: r.model, scope: r.scope, total_ex_gst: r.total,
      questions: r.questions, cost_usd: r.costUsd, latency_ms: r.latencyMs, error: r.error, created_by: null,
    })));
  }

  return { kind: "drafted", siteQuoteId: made.id as string, questions: scope.questions.length };
}

/** "jane@brownbuilders.com.au" -> "Brownbuilders" (a starting point the estimator can fix). */
function companyFromEmail(email: string | null): string | null {
  const d = email?.split("@")[1]?.split(".")[0];
  if (!d || /^(gmail|outlook|hotmail|live|yahoo|icloud|bigpond|optusnet)$/i.test(d)) return null;
  return d.charAt(0).toUpperCase() + d.slice(1);
}

export type GatheredRfq = {
  summary: RfqSummary;
  rfq: { from: string | null; subject: string | null; date: string | null; body: string; name: string };
  emails: { from: string | null; subject: string | null; date: string | null; body: string; name: string }[];
  attachments: RfqAttachment[];
  summaryFiles: RfqSummary["files"];
};

/** Everything that came with an RFQ job: its emails, and what could be read from its files. */
export async function gatherRfq(db: SupabaseClient, tenantId: string, jobId: string, jobSite: string | null,
  messages: { from_address: string | null; subject: string | null; received_at: string | null }[]): Promise<GatheredRfq> {
  // The emails, as filed under "4. Correspondence" (the RFQ first, then any replies).
  const { data: corr } = await db.storage.from(BUCKET).list(`${tenantId}/${jobId}/4. Correspondence`, { limit: 50 });
  const emails: { from: string | null; subject: string | null; date: string | null; body: string; name: string }[] = [];
  for (const f of corr ?? []) {
    if (!f.name || f.name.startsWith(".")) continue;
    const text = new TextDecoder().decode(await download(db, `${tenantId}/${jobId}/4. Correspondence/${f.name}`));
    emails.push({ ...splitSavedEmail(text), name: f.name });
  }
  emails.sort((a, b) => (a.name.startsWith("RFQ") ? -1 : b.name.startsWith("RFQ") ? 1 : String(a.date).localeCompare(String(b.date))));
  const first = messages?.[0];
  const rfq = emails[0] ?? { from: first?.from_address ?? null, subject: first?.subject ?? jobSite, date: first?.received_at ?? null, body: "", name: "" };

  // Attachments: read the text out of what we can, send images as pictures.
  const { data: files } = await db.from("attachments").select("id, filename, mime, size_bytes, storage_path")
    .eq("tenant_id", tenantId).eq("job_id", jobId).order("created_at", { ascending: true }).limit(MAX_FILES);
  const attachments: RfqAttachment[] = [];
  const summaryFiles: RfqSummary["files"] = [];
  for (const f of files ?? []) {
    const path = String(f.storage_path);
    if (!path.startsWith(`${tenantId}/`)) continue;
    if (Number(f.size_bytes) > MAX_FILE_BYTES) {
      attachments.push({ name: f.filename, text: null, imageUrl: null, pdfUrl: null, note: "too big to read: check it by eye" });
      summaryFiles.push({ name: f.filename, path, read: "no", note: "too big to read" });
      continue;
    }
    const read = await readFile(f.filename, f.mime, await download(db, path));
    let imageUrl: string | null = null;
    let pdfUrl: string | null = null;
    if (read.kind === "image" || (read.kind === "pdf" && !read.text)) {
      const { data } = await db.storage.from(BUCKET).createSignedUrl(path, 3600);
      if (read.kind === "image") imageUrl = data?.signedUrl ?? null;
      else pdfUrl = data?.signedUrl ?? null;
    }
    attachments.push({ name: f.filename, text: read.text, imageUrl, pdfUrl, note: read.note });
    summaryFiles.push({ name: f.filename, path, read: read.text ? "text" : imageUrl ? "image" : "no", note: read.note });
    await db.from("attachments").update({ read_ok: Boolean(read.text || imageUrl) }).eq("tenant_id", tenantId).eq("id", f.id);
  }

  // Forwarded to quoteout (or to the inbox by a colleague): the customer is whoever sent the original.
  const fwd = forwardedFrom(rfq.body);
  const fwdFrom = fwd && (fwd.name || fwd.email) ? (fwd.name && fwd.email ? `${fwd.name} <${fwd.email}>` : (fwd.name ?? fwd.email)!) : null;
  const summary: RfqSummary = {
    from: fwdFrom ?? rfq.from ?? first?.from_address ?? "unknown sender",
    subject: cleanSubject(fwd?.subject ?? rfq.subject ?? first?.subject ?? jobSite ?? "RFQ") || "RFQ",
    received: fwd?.date ?? rfq.date ?? first?.received_at ?? null,
    forwardedBy: fwdFrom ? (rfq.from ?? first?.from_address ?? null) : null,
    original: fwd,
    portal: detectPortal(rfq.body, fwd?.email ?? rfq.from),
    links: findDocLinks(rfq.body),
    files: summaryFiles,
    followUps: Math.max(0, (messages?.length ?? 1) - 1),
  };

  return { summary, rfq, emails, attachments, summaryFiles };
}

/** Find the job on the map, pick the plant if none was named, and price the scope. */
export async function locateAndPrice(pc: Awaited<ReturnType<typeof loadPricingContext>>, input: SiteScope) {
  let scope = input;
  // Where's the job? Search near their plants so "Smith St" finds the right one.
  let site: { lat: number | null; lng: number | null; address: string } = { lat: null, lng: null, address: "" };
  const where = scope.site_location?.trim();
  if (where && where.length >= 3) {
    try {
      const anchor = pc.plants.find((p) => p.lat != null && p.lng != null);
      const [hit] = await searchPlaces(where, { apiKey: process.env.GOOGLE_MAPS_API_KEY || null, near: anchor ? { lat: anchor.lat!, lng: anchor.lng! } : null });
      if (hit) site = { lat: hit.lat, lng: hit.lng, address: hit.address || where };
      else site.address = where;
    } catch {
      site.address = where;
    }
  }
  if (site.lat == null) scope.questions.push(where ? `Couldn't find "${where}" on the map. Find the site under Cartage so trucks can be priced.` : "Where is the job? Find the site under Cartage so trucks can be priced.");

  const routes = await routesToPlants(site, pc.plants).catch(() => null);
  if (!scope.supply_plant_id && site.lat != null) scope = choosePlant({ scope, library: pc.library, plants: pc.plants, settings: pc.settings, site, routes });
  const priced = priceSiteQuote({ scope, library: pc.library, settings: pc.settings, haul: haulFor(scope, site, pc.plants, pc.settings, routes), marginPercent: pc.defaultMargin });

  return { scope, site, routes, priced };
}

/** Pull the specs, dates and conditions out of an RFQ. Null if the AI isn't on or it fails: the quote doesn't wait on it. */
export async function makeOverview(tenantId: string, input: Parameters<typeof buildRfqUserMessage>[0]): Promise<Overview | null> {
  try {
    const call = await aiCaller(OVERVIEW_SCHEMA, tenantId, null, "ai_overview");
    if (!call) return null;
    const r = await call(overviewMessages(buildRfqUserMessage(input)));
    return { ...cleanOverview(r.json), made_at: new Date().toISOString() };
  } catch {
    return null;
  }
}
