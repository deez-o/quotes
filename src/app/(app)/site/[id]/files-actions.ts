"use server";

import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { requireTenant } from "@/lib/tenant";
import { createAdminClient } from "@/lib/supabase/admin";
import { storagePath } from "@/lib/worker/process-message";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BUCKET = "job-files";
const MAX_FILES = 40;
const MAX_INNER = 25 * 1024 * 1024;
const READABLE = /\.(pdf|png|jpe?g|webp|gif|xlsx|xlsm|xls|csv|docx|txt)$/i;

const mimeOf = (n: string) => /\.pdf$/i.test(n) ? "application/pdf"
  : /\.(png|jpe?g|gif|webp)$/i.test(n) ? `image/${n.split(".").pop()!.toLowerCase().replace("jpg", "jpeg")}`
  : /\.xlsx$|\.xlsm$/i.test(n) ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  : /\.xls$/i.test(n) ? "application/vnd.ms-excel"
  : /\.docx$/i.test(n) ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  : /\.csv$/i.test(n) ? "text/csv" : /\.txt$/i.test(n) ? "text/plain" : "application/octet-stream";

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

  const out: { name: string; bytes: Uint8Array }[] = [];
  const skipped: string[] = [];
  for (const p of paths) {
    const { data, error } = await db.storage.from(BUCKET).download(p);
    if (error || !data) return { ok: false, message: `Couldn't open ${p.split("/").pop()}.` };
    const bytes = new Uint8Array(await data.arrayBuffer());
    const name = p.split("/").pop()!.replace(/^\d+-/, "");
    if (/\.zip$/i.test(name)) {
      const JSZip = (await import("jszip")).default;
      const zip = await JSZip.loadAsync(bytes).catch(() => null);
      if (!zip) { skipped.push(`${name} (couldn't open the zip)`); continue; }
      for (const entry of Object.values(zip.files)) {
        const inner = entry.name.split("/").pop() ?? "";
        if (entry.dir || !inner || entry.name.startsWith("__MACOSX") || inner.startsWith(".")) continue;
        if (!READABLE.test(inner)) { skipped.push(inner); continue; }
        const b = await entry.async("uint8array");
        if (b.byteLength > MAX_INNER) { skipped.push(`${inner} (too big)`); continue; }
        out.push({ name: inner, bytes: b });
      }
    } else if (READABLE.test(name)) {
      out.push({ name, bytes });
    } else {
      skipped.push(name);
    }
    await db.storage.from(BUCKET).remove([p]);
  }
  if (!out.length) return { ok: false, message: `No drawings, specs or schedules found${skipped.length ? ` (skipped ${skipped.slice(0, 5).join(", ")})` : ""}.` };

  // Schedules and specs first, then drawings, so the most useful files are read if there are many.
  const rank = (n: string) => (/schedule|quantit|boq|scope|spec|tender|rfq/i.test(n) ? 0 : /\.pdf$/i.test(n) ? 1 : 2);
  out.sort((a, b) => rank(a.name) - rank(b.name));
  const { data: have } = await db.from("attachments").select("sha256").eq("tenant_id", t).eq("job_id", q.job_id);
  const seen = new Set((have ?? []).map((h) => h.sha256 as string));
  let added = 0;
  for (const f of out.slice(0, MAX_FILES)) {
    const sha256 = createHash("sha256").update(f.bytes).digest("hex");
    if (seen.has(sha256)) continue;
    seen.add(sha256);
    const path = storagePath(t, q.job_id as string, "0. Incoming", f.name);
    const { error } = await db.storage.from(BUCKET).upload(path, f.bytes, { contentType: mimeOf(f.name), upsert: true });
    if (error) return { ok: false, message: `${f.name}: ${error.message}` };
    await db.from("attachments").insert({ tenant_id: t, job_id: q.job_id, filename: f.name, mime: mimeOf(f.name), size_bytes: f.bytes.byteLength, sha256, storage_path: path, read_ok: null });
    added++;
  }
  if (out.length > MAX_FILES) skipped.push(`${out.length - MAX_FILES} more files (limit ${MAX_FILES})`);

  await db.from("queue_jobs").insert({ tenant_id: t, kind: "draft_quote", payload: { job_id: q.job_id, redo: true } });
  await db.from("jobs").update({ status: "processing", updated_at: new Date().toISOString() }).eq("tenant_id", t).eq("id", q.job_id);
  await db.from("audit_log").insert({ tenant_id: t, actor: ctx.userId, action: "rfq.files_added", target: q.id, detail: { added, skipped: skipped.length } });
  revalidatePath(`/site/${q.id}`);
  return { ok: true, added, skipped };
}
