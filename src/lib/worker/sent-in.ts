/**
 * RFQs the estimator sends in themselves: dragged into the portal, or
 * forwarded to the customer's QUOTES address. Both end up in processMessage
 * exactly like an email from a connected inbox.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  fromLooseFiles, isEmailFile, parseEml, parseEmailFile, unwrapForwarded, type LooseFile, type ParsedEmail,
} from "@/lib/mail/parse-files";
import { inMemoryMailbox, processMessage, type ProcessResult, type StorePort } from "./process-message";
import { BUCKET } from "./supabase-store";

/**
 * Uploaded files -> one message. If an email file is among them, it is the RFQ
 * and the other files join it; otherwise the pasted text (if any) is the email.
 */
export async function messageFromUpload(files: LooseFile[], pastedText: string, uploader: string, uploadId: string): Promise<ParsedEmail> {
  const emailFile = files.find((f) => isEmailFile(f.name, f.type));
  if (!emailFile) return fromLooseFiles({ files, pastedText, uploader, idPrefix: `upload-${uploadId}` });

  const parsed = await parseEmailFile(emailFile, `upload-${uploadId}`);
  let n = 0;
  for (const f of files) {
    if (f === emailFile) continue;
    const id = `upload-${uploadId}-x${++n}`;
    parsed.message.attachments.push({ id, name: f.name, contentType: f.type || "application/octet-stream", size: f.bytes.byteLength, isInline: false });
    parsed.files.set(id, f.bytes);
  }
  if (pastedText.trim()) parsed.message.bodyText = `${parsed.message.bodyText}\n\n[Note from estimator]\n${pastedText.trim()}`;
  return parsed;
}

/** Raw forwarded email -> the original RFQ as a message, plus who forwarded it. */
export async function messageFromForward(raw: Uint8Array, inboundId: string) {
  const outer = await parseEml(raw, `fwd-${inboundId}`);
  const unwrapped = await unwrapForwarded(outer, `fwd-${inboundId}`);
  if (unwrapped.note) {
    unwrapped.message.bodyText = `${unwrapped.message.bodyText}\n\n[Note from ${unwrapped.forwardedBy}]\n${unwrapped.note}`;
  }
  return unwrapped;
}

/** Uploads and forwards are recorded against one pseudo-connection per tenant and kind. */
export async function ensureConnection(db: SupabaseClient, tenantId: string, provider: "upload" | "forwarding"): Promise<string> {
  const { data } = await db.from("connections").select("id")
    .eq("tenant_id", tenantId).eq("provider", provider).eq("purpose", "mailbox").limit(1).maybeSingle();
  if (data?.id) return data.id as string;
  const { data: created, error } = await db.from("connections").insert({
    tenant_id: tenantId, provider, purpose: "mailbox", status: "ok", last_ok_at: new Date().toISOString(),
  }).select("id").single();
  if (error || !created) throw new Error(`Could not create ${provider} connection: ${error?.message}`);
  return created.id as string;
}

async function download(db: SupabaseClient, path: string): Promise<Uint8Array> {
  const { data, error } = await db.storage.from(BUCKET).download(path);
  if (error || !data) throw new Error(`Download ${path}: ${error?.message ?? "missing"}`);
  return new Uint8Array(await data.arrayBuffer());
}

export async function processUpload(
  db: SupabaseClient,
  store: StorePort,
  tenantId: string,
  payload: { upload_id: string; paths: string[]; pasted_text?: string; uploader: string },
): Promise<ProcessResult> {
  const prefix = `${tenantId}/uploads/${payload.upload_id}/`;
  const files: LooseFile[] = [];
  for (const path of payload.paths) {
    if (!path.startsWith(prefix)) throw new Error("Upload path outside this tenant's upload folder.");
    const name = path.slice(prefix.length);
    const type = /\.pdf$/i.test(name) ? "application/pdf"
      : /\.xlsx?$|\.xlsm$/i.test(name) ? "application/vnd.ms-excel"
      : /\.(png|jpe?g|gif|webp)$/i.test(name) ? `image/${name.split(".").pop()!.toLowerCase().replace("jpg", "jpeg")}`
      : /\.eml$/i.test(name) ? "message/rfc822"
      : /\.msg$/i.test(name) ? "application/vnd.ms-outlook"
      : "application/octet-stream";
    files.push({ name, type, bytes: await download(db, path) });
  }
  const { message, files: bytes } = await messageFromUpload(files, payload.pasted_text ?? "", payload.uploader, payload.upload_id);
  const connectionId = await ensureConnection(db, tenantId, "upload");
  return processMessage({ tenantId, connectionId, messageId: message.id }, inMemoryMailbox(message, bytes), store, { source: "upload", forceRfq: true });
}

export async function processInbound(
  db: SupabaseClient,
  store: StorePort,
  tenantId: string,
  payload: { path: string; inbound_id: string },
): Promise<ProcessResult> {
  if (!payload.path.startsWith(`${tenantId}/inbound/`)) throw new Error("Inbound path outside this tenant's folder.");
  const raw = await download(db, payload.path);
  const { message, files } = await messageFromForward(raw, payload.inbound_id);
  const connectionId = await ensureConnection(db, tenantId, "forwarding");
  return processMessage({ tenantId, connectionId, messageId: message.id }, inMemoryMailbox(message, files), store, { source: "forward", forceRfq: true });
}
