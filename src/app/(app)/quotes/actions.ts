"use server";

import { revalidatePath } from "next/cache";
import { requireTenant } from "@/lib/tenant";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Delete a quote for good: a site quote with its photos, or an RFQ job with its files. */
export async function deleteQuote(input: { kind: "site" | "rfq"; id: string }): Promise<{ ok: boolean; message?: string }> {
  const ctx = await requireTenant();
  if (ctx.role === "viewer") return { ok: false, message: "You can view quotes but not delete them." };
  if (!UUID.test(input.id) || (input.kind !== "site" && input.kind !== "rfq")) return { ok: false, message: "Quote not found." };
  const db = await createClient();
  const t = ctx.tenant.id;

  let paths: string[] = [];
  if (input.kind === "site") {
    const { data } = await db.from("site_quotes").select("photos").eq("id", input.id).eq("tenant_id", t).maybeSingle();
    if (!data) return { ok: false, message: "Quote not found." };
    paths = ((data.photos ?? []) as string[]).filter((p) => p.startsWith(`${t}/`));
    const { error } = await db.from("site_quotes").delete().eq("id", input.id).eq("tenant_id", t);
    if (error) return { ok: false, message: error.message };
  } else {
    const { data: files } = await db.from("attachments").select("storage_path").eq("job_id", input.id).eq("tenant_id", t);
    paths = (files ?? []).map((f) => f.storage_path as string).filter((p) => p?.startsWith(`${t}/`));
    // Its drafted quote goes with it.
    await db.from("site_quotes").delete().eq("job_id", input.id).eq("tenant_id", t);
    const { error, count } = await db.from("jobs").delete({ count: "exact" }).eq("id", input.id).eq("tenant_id", t);
    if (error) return { ok: false, message: error.message };
    if (!count) return { ok: false, message: "Quote not found, or you can't delete it." };
  }
  if (paths.length) await db.storage.from("job-files").remove(paths.slice(0, 500));
  revalidatePath("/quotes");
  return { ok: true };
}

/** RFQ drafts read before the company's costs were in: unsent, with nothing priced. */
export async function staleRfqDrafts(db: Awaited<ReturnType<typeof createClient>>, tenantId: string) {
  const { data } = await db.from("site_quotes").select("id, job_id, scope").eq("tenant_id", tenantId)
    .not("job_id", "is", null).is("sent_at", null).is("option_group", null).eq("revision", 0).eq("total_ex_gst", 0).limit(100);
  return (data ?? []).filter((q) => {
    const sc = q.scope as { items?: unknown[]; questions?: string[] } | null;
    return !(sc?.items?.length) && (sc?.questions ?? []).some((x) => x.startsWith("Your costs library is empty") || x.startsWith("The AI isn't switched on"));
  }).map((q) => ({ id: q.id as string, jobId: q.job_id as string }));
}

/** Read RFQs again now the costs are in (one quote, or all that were read too early). */
export async function rereadRfqs(input: { siteQuoteId?: string } = {}): Promise<{ ok: true; count: number } | { ok: false; message: string }> {
  const ctx = await requireTenant();
  if (ctx.role === "viewer") return { ok: false, message: "Viewers can't change quotes." };
  const db = await createClient();
  const t = ctx.tenant.id;
  const { count: costs } = await db.from("cost_items").select("id", { count: "exact", head: true }).eq("tenant_id", t).eq("active", true);
  if (!costs) return { ok: false, message: "Add your costs first (Setup → Put in your costs)." };

  let targets: { id: string; jobId: string }[];
  if (input.siteQuoteId) {
    if (!UUID.test(input.siteQuoteId)) return { ok: false, message: "Quote not found." };
    const { data: q } = await db.from("site_quotes").select("id, job_id, sent_at, option_group, revision").eq("tenant_id", t).eq("id", input.siteQuoteId).maybeSingle();
    if (!q?.job_id) return { ok: false, message: "Only quotes made from an RFQ can be read again." };
    if (q.sent_at || q.option_group || Number(q.revision) > 0) return { ok: false, message: "This quote has been sent or has options or revisions, so it can't be read again. Make a revision instead." };
    targets = [{ id: q.id as string, jobId: q.job_id as string }];
  } else {
    targets = await staleRfqDrafts(db, t);
  }
  if (!targets.length) return { ok: true, count: 0 };

  const admin = createAdminClient();
  const { error } = await admin.from("queue_jobs").insert(targets.map((x) => ({ tenant_id: t, kind: "draft_quote", payload: { job_id: x.jobId, redo: true } })));
  if (error) return { ok: false, message: error.message };
  await admin.from("jobs").update({ status: "processing", updated_at: new Date().toISOString() }).eq("tenant_id", t).in("id", targets.map((x) => x.jobId));
  revalidatePath("/quotes");
  return { ok: true, count: targets.length };
}
