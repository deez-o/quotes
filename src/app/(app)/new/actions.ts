"use server";

import { requireTenant } from "@/lib/tenant";
import { createAdminClient } from "@/lib/supabase/admin";

export type QueueUploadResult = { ok: boolean; message: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** After the browser has uploaded the files, queue them to be filed and drafted. */
export async function queueUpload(input: { uploadId: string; paths: string[]; pastedText: string }): Promise<QueueUploadResult> {
  const ctx = await requireTenant();
  if (ctx.role === "viewer") return { ok: false, message: "Viewers can't send in RFQs." };
  if (!UUID.test(input.uploadId)) return { ok: false, message: "Upload id is not valid." };

  const prefix = `${ctx.tenant.id}/uploads/${input.uploadId}/`;
  const paths = input.paths.filter((p) => typeof p === "string" && p.startsWith(prefix) && !p.includes(".."));
  const pastedText = String(input.pastedText ?? "").slice(0, 50_000);
  if (paths.length === 0 && pastedText.trim().length < 10) {
    return { ok: false, message: "Add the RFQ email or files, or paste the email text." };
  }
  if (paths.length > 60) return { ok: false, message: "That's more than 60 files. Please split it into two." };

  let db;
  try {
    db = createAdminClient();
  } catch {
    return { ok: false, message: "Processing isn't switched on on the server yet (missing service key)." };
  }

  const { error } = await db.from("queue_jobs").insert({
    tenant_id: ctx.tenant.id,
    kind: "process_upload",
    payload: { upload_id: input.uploadId, paths, pasted_text: pastedText, uploader: ctx.email ?? "" },
    dedupe_key: `upload:${input.uploadId}`,
  });
  if (error) return { ok: false, message: `Couldn't queue it: ${error.message}` };

  await db.from("audit_log").insert({
    tenant_id: ctx.tenant.id, actor: ctx.userId, action: "rfq.uploaded", target: input.uploadId,
    detail: { files: paths.length, pasted: pastedText.length > 0 },
  });
  return { ok: true, message: "Sent in." };
}
