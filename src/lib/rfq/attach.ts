/**
 * Adding documents to an RFQ job: plain files or zips (unpacked), kept if they can be read
 * (drawings, specs, schedules), saved under "0. Incoming" with an attachments row each.
 */
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { storagePath } from "@/lib/worker/process-message";

const BUCKET = "job-files";
export const MAX_RFQ_FILES = 40;
const MAX_INNER = 25 * 1024 * 1024;
const READABLE = /\.(pdf|png|jpe?g|webp|gif|xlsx|xlsm|xls|csv|docx|txt)$/i;

export const mimeOf = (n: string) => /\.pdf$/i.test(n) ? "application/pdf"
  : /\.(png|jpe?g|gif|webp)$/i.test(n) ? `image/${n.split(".").pop()!.toLowerCase().replace("jpg", "jpeg")}`
  : /\.xlsx$|\.xlsm$/i.test(n) ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  : /\.xls$/i.test(n) ? "application/vnd.ms-excel"
  : /\.docx$/i.test(n) ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  : /\.csv$/i.test(n) ? "text/csv" : /\.txt$/i.test(n) ? "text/plain" : "application/octet-stream";

/** Files and zips -> the readable files inside, schedules and specs first. */
export async function unpackFiles(input: { name: string; bytes: Uint8Array }[]): Promise<{ files: { name: string; bytes: Uint8Array }[]; skipped: string[] }> {
  const files: { name: string; bytes: Uint8Array }[] = [];
  const skipped: string[] = [];
  for (const f of input) {
    if (/\.zip$/i.test(f.name)) {
      const JSZip = (await import("jszip")).default;
      const zip = await JSZip.loadAsync(f.bytes).catch(() => null);
      if (!zip) { skipped.push(`${f.name} (couldn't open the zip)`); continue; }
      for (const entry of Object.values(zip.files)) {
        const inner = entry.name.split("/").pop() ?? "";
        if (entry.dir || !inner || entry.name.startsWith("__MACOSX") || inner.startsWith(".")) continue;
        if (/\.zip$/i.test(inner)) { const nested = await unpackFiles([{ name: inner, bytes: await entry.async("uint8array") }]); files.push(...nested.files); skipped.push(...nested.skipped); continue; }
        if (!READABLE.test(inner)) { skipped.push(inner); continue; }
        const b = await entry.async("uint8array");
        if (b.byteLength > MAX_INNER) { skipped.push(`${inner} (too big)`); continue; }
        files.push({ name: inner, bytes: b });
      }
    } else if (READABLE.test(f.name)) {
      files.push(f);
    } else {
      skipped.push(f.name);
    }
  }
  const rank = (n: string) => (/schedule|quantit|boq|scope|spec|tender|rfq|price/i.test(n) ? 0 : /\.pdf$/i.test(n) ? 1 : 2);
  files.sort((a, b) => rank(a.name) - rank(b.name));
  return { files, skipped };
}

/** Save files onto an RFQ job (skipping ones it already has). Returns how many were added. */
export async function attachToJob(db: SupabaseClient, tenantId: string, jobId: string, files: { name: string; bytes: Uint8Array }[]): Promise<{ added: number; overLimit: number }> {
  const { data: have } = await db.from("attachments").select("sha256").eq("tenant_id", tenantId).eq("job_id", jobId);
  const seen = new Set((have ?? []).map((h) => h.sha256 as string));
  let added = 0;
  for (const f of files.slice(0, MAX_RFQ_FILES)) {
    const sha256 = createHash("sha256").update(f.bytes).digest("hex");
    if (seen.has(sha256)) continue;
    seen.add(sha256);
    const path = storagePath(tenantId, jobId, "0. Incoming", f.name);
    const { error } = await db.storage.from(BUCKET).upload(path, f.bytes, { contentType: mimeOf(f.name), upsert: true });
    if (error) throw new Error(`${f.name}: ${error.message}`);
    await db.from("attachments").insert({ tenant_id: tenantId, job_id: jobId, filename: f.name, mime: mimeOf(f.name), size_bytes: f.bytes.byteLength, sha256, storage_path: path, read_ok: null });
    added++;
  }
  return { added, overLimit: Math.max(0, files.length - MAX_RFQ_FILES) };
}
