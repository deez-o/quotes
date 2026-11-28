"use server";

import { revalidatePath } from "next/cache";
import { requireTenant } from "@/lib/tenant";
import { createAdminClient } from "@/lib/supabase/admin";
import { attachToJob, MAX_RFQ_FILES, unpackFiles } from "@/lib/rfq/attach";
import { findDocLinks } from "@/lib/rfq/links";
import type { RfqSummary } from "@/lib/rfq/split";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BUCKET = "job-files";

/**
 * Add documents to an RFQ (e.g. downloaded from a tender portal): files or a zip of them.
 * Zips are unpacked; drawings, specs and schedules are kept. Then the RFQ is read again.
 */
export async function addRfqFiles(input: { id: string; paths: string[] }): Promise<{ ok: true; added: number; skipped: string[] } | { ok: false; message: string }> {
  const ctx = await requireTenant();
  if (ctx.role === "viewer") return { ok: false, message: "Viewers can't change quotes." };
  if (!UUID.test(input.id)) return { ok: false, message: "Quote not found." };
  const t = ctx.tenant.id;
  const db = createAdminClient();
  const { data: q } = await db.from("site_quotes").select("id, job_id, sent_at, option_group, revision").eq("tenant_id", t).eq("id", input.id).maybeSingle();
  if (!q?.job_id) return { ok: false, message: "Only quotes made from an RFQ take documents." };
  if (q.sent_at || q.option_group || Number(q.revision) > 0) return { ok: false, message: "This quote has been sent or has options or revisions. Make a revision to add documents." };
  const paths = (input.paths ?? []).filter((p) => typeof p === "string" && p.startsWith(`${t}/uploads/`)).slice(0, 10);
  if (!paths.length) return { ok: false, message: "Nothing uploaded." };

  const raw: { name: string; bytes: Uint8Array }[] = [];
  for (const p of paths) {
    const { data, error } = await db.storage.from(BUCKET).download(p);
    if (error || !data) return { ok: false, message: `Couldn't open ${p.split("/").pop()}.` };
    raw.push({ name: p.split("/").pop()!.replace(/^\d+-/, ""), bytes: new Uint8Array(await data.arrayBuffer()) });
    await db.storage.from(BUCKET).remove([p]);
  }
  const { files, skipped } = await unpackFiles(raw);
  if (!files.length) return { ok: false, message: `No drawings, specs or schedules found${skipped.length ? ` (skipped ${skipped.slice(0, 5).join(", ")})` : ""}.` };
  const { added, overLimit } = await attachToJob(db, t, q.job_id as string, files);
  if (overLimit) skipped.push(`${overLimit} more files (limit ${MAX_RFQ_FILES})`);

  await db.from("queue_jobs").insert({ tenant_id: t, kind: "draft_quote", payload: { job_id: q.job_id, redo: true } });
  await db.from("jobs").update({ status: "processing", updated_at: new Date().toISOString() }).eq("tenant_id", t).eq("id", q.job_id);
  await db.from("audit_log").insert({ tenant_id: t, actor: ctx.userId, action: "rfq.files_added", target: q.id, detail: { added, skipped: skipped.length } });
  revalidatePath(`/site/${q.id}`);
  return { ok: true, added, skipped };
}

/** Fetch a tender's documents from its portal now (with the saved login). */
export async function fetchPortalNow(input: { id: string }): Promise<{ ok: true } | { ok: false; message: string }> {
  const ctx = await requireTenant();
  if (ctx.role === "viewer") return { ok: false, message: "Viewers can't change quotes." };
  if (!UUID.test(input.id)) return { ok: false, message: "Quote not found." };
  const db = createAdminClient();
  const { data: q } = await db.from("site_quotes").select("id, job_id, sent_at, rfq_summary").eq("tenant_id", ctx.tenant.id).eq("id", input.id).maybeSingle();
  if (!q?.job_id || q.sent_at) return { ok: false, message: "Only unsent RFQ quotes can fetch documents." };
  // Quotes read before links were picked up: look for them in the saved emails now.
  const summary = (q.rfq_summary ?? {}) as RfqSummary;
  if (!summary.portal && !summary.links?.length) {
    const folder = `${ctx.tenant.id}/${q.job_id}/4. Correspondence`;
    const { data: files } = await db.storage.from("job-files").list(folder, { limit: 20 });
    let text = "";
    for (const f of files ?? []) {
      const { data } = await db.storage.from("job-files").download(`${folder}/${f.name}`);
      if (data) text += `\n${await data.text()}`;
    }
    const links = findDocLinks(text);
    if (!links.length) return { ok: false, message: "No SharePoint, OneDrive, Dropbox or Google Drive links found in the emails." };
    await db.from("site_quotes").update({ rfq_summary: { ...summary, links } }).eq("id", q.id).eq("tenant_id", ctx.tenant.id);
  }
  await db.from("site_quotes").update({ portal_fetch: { ok: null, at: new Date().toISOString(), message: "Fetching..." } }).eq("id", q.id).eq("tenant_id", ctx.tenant.id);
  const { error } = await db.from("queue_jobs").insert({ tenant_id: ctx.tenant.id, kind: "portal_fetch", payload: { job_id: q.job_id } });
  if (error) return { ok: false, message: error.message };
  revalidatePath(`/site/${q.id}`);
  return { ok: true };
}
