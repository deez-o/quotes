/**
 * Worker step for one new email: fetch it once, download real attachments
 * (skipping signature logos), sort it, link it to a job or open a new one,
 * file everything under the tenant's folder, and label it in the mailbox.
 *
 * Every step is safe to run twice: a seen message does nothing, files
 * overwrite by name, labels are merged.
 */
import { createHash } from "node:crypto";
import { contentHash, decideLink, isSignatureImage, normaliseSubject, sortMessage } from "@/lib/mail/sort";
import type { Category, IncomingMessage } from "@/lib/mail/types";

export const LABELS = {
  toBeQuoted: "Quotr/1. To Be Quoted",
  duplicate: "Quotr/Duplicate",
  award: "Quotr/Award",
  invoice: "Quotr/Invoice",
  needsAttention: "Quotr/Needs Attention",
} as const;

export const LIMITS = { maxTotalBytes: 250 * 1024 * 1024, maxFiles: 60 };

export type MailboxPort = {
  getMessage(id: string): Promise<IncomingMessage>;
  downloadAttachment(messageId: string, attachmentId: string): Promise<Uint8Array>;
  addCategories(messageId: string, existing: string[], add: string[]): Promise<void>;
};

export type StorePort = {
  isSeen(tenantId: string, connectionId: string, messageId: string): Promise<boolean>;
  jobForConversation(tenantId: string, conversationId: string): Promise<string | null>;
  jobForContentHash(tenantId: string, hash: string): Promise<string | null>;
  createJob(tenantId: string, input: { subject: string; from: string; module: "quoting"; source: JobSource }): Promise<{ jobId: string; quoteNo: string }>;
  saveMessage(row: {
    tenant_id: string; connection_id: string; provider_message_id: string; thread_id: string;
    from_address: string; subject: string; received_at: string; content_hash: string;
    category: Category; module: string | null; job_id: string | null;
  }): Promise<void>;
  putFile(path: string, bytes: Uint8Array, contentType: string): Promise<void>;
  saveAttachment(row: {
    tenant_id: string; job_id: string; filename: string; mime: string; size_bytes: number;
    sha256: string; storage_path: string; read_ok: boolean | null;
  }): Promise<void>;
  enqueueDraft(tenantId: string, jobId: string): Promise<void>;
};

export type JobSource = "inbox" | "forward" | "upload";

export type ProcessOptions = {
  /** Where the email came from. Forwarded and uploaded emails were chosen by the estimator. */
  source?: JobSource;
  /** Treat as an RFQ whatever the sorting says (the estimator sent it in to be quoted). */
  forceRfq?: boolean;
  /** Label the email in the mailbox (only for a connected inbox). */
  label?: boolean;
};

export type ProcessResult = {
  action: "already_seen" | "no_job" | "attach_to_job" | "duplicate" | "new_job";
  category: Category;
  jobId: string | null;
  quoteNo: string | null;
  filesSaved: number;
  skipped: string[];
  labels: string[];
};

const sha256 = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

/** Short, clear names for saved emails: "RFQ - Carpark Capalaba.eml" (not the full subject line). */
export function shortEmailName(subject: string, kind: "RFQ" | "Reply" = "RFQ"): string {
  const s = normaliseSubject(subject)
    .replace(/\b(rfq|request for (a )?(quote|quotation)|quote|quotation|pricing( please)?|tender)\b[:\s-]*/gi, "")
    .replace(/[^\w\s,.-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const titled = s.replace(/\b\w/g, (c) => c.toUpperCase()).slice(0, 60).trim();
  return `${kind} - ${titled || "Untitled"}.eml`;
}

/** Storage path inside the tenant's area. Always starts with the tenant id. */
export function storagePath(tenantId: string, jobId: string, folder: string, filename: string): string {
  const safe = filename.replace(/[\\/:*?"<>|]+/g, "_").slice(0, 120);
  return `${tenantId}/${jobId}/${folder}/${safe}`;
}

/** Plain-text copy of the email for the Correspondence folder. */
export function emailAsText(m: IncomingMessage): string {
  return [`From: ${m.from}`, `To: ${m.to}`, `Date: ${m.receivedAt}`, `Subject: ${m.subject}`, "", m.bodyText].join("\r\n");
}

export async function processMessage(
  args: { tenantId: string; connectionId: string; messageId: string },
  mailbox: MailboxPort,
  store: StorePort,
  options: ProcessOptions = {},
): Promise<ProcessResult> {
  const { tenantId, connectionId, messageId } = args;
  const source = options.source ?? "inbox";
  const label = options.label ?? source === "inbox";

  if (await store.isSeen(tenantId, connectionId, messageId)) {
    return { action: "already_seen", category: "general", jobId: null, quoteNo: null, filesSaved: 0, skipped: [], labels: [] };
  }

  const msg = await mailbox.getMessage(messageId);

  // Download real attachments once (needed for the duplicate check and the job pack).
  const skipped: string[] = [];
  const files: { name: string; type: string; bytes: Uint8Array; hash: string }[] = [];
  let total = 0;
  for (const a of msg.attachments) {
    if (isSignatureImage(a)) {
      skipped.push(`${a.name} (signature image)`);
      continue;
    }
    if (files.length >= LIMITS.maxFiles || total + a.size > LIMITS.maxTotalBytes) {
      skipped.push(`${a.name} (over the size limit: filed but not read)`);
      continue;
    }
    const bytes = await mailbox.downloadAttachment(msg.id, a.id);
    total += bytes.byteLength;
    const hash = sha256(bytes);
    a.sha256 = hash;
    files.push({ name: a.name, type: a.contentType, bytes, hash });
  }

  const sorted = sortMessage(msg);
  const sort = options.forceRfq && sorted.category !== "rfq"
    ? { category: "rfq" as const, confident: true, reason: "Sent in by the estimator to be quoted." }
    : sorted;
  const hash = contentHash(msg);
  const threadJob = await store.jobForConversation(tenantId, msg.conversationId);
  const hashJob = sort.category === "rfq" && !threadJob ? await store.jobForContentHash(tenantId, hash) : null;

  const decision = decideLink(msg, sort.category, {
    seenMessageIds: new Set(),
    jobByConversation: new Map(threadJob ? [[msg.conversationId, threadJob]] : []),
    jobByContentHash: new Map(hashJob ? [[hash, hashJob]] : []),
  });

  let jobId: string | null = null;
  let quoteNo: string | null = null;
  const labels: string[] = [];

  if (decision.action === "new_job") {
    const created = await store.createJob(tenantId, { subject: msg.subject, from: msg.from, module: "quoting", source });
    jobId = created.jobId;
    quoteNo = created.quoteNo;
    labels.push(LABELS.toBeQuoted);
  } else if (decision.action === "attach_to_job") {
    jobId = decision.jobId;
    labels.push(LABELS.toBeQuoted);
  } else if (decision.action === "duplicate") {
    jobId = decision.jobId;
    labels.push(LABELS.duplicate);
  } else if (sort.category === "award") {
    labels.push(LABELS.award);
  } else if (sort.category === "invoice") {
    labels.push(LABELS.invoice);
  }

  await store.saveMessage({
    tenant_id: tenantId, connection_id: connectionId, provider_message_id: msg.id, thread_id: msg.conversationId,
    from_address: msg.from, subject: msg.subject, received_at: msg.receivedAt, content_hash: hash,
    category: sort.category, module: jobId ? "quoting" : "inbox_sorting", job_id: jobId,
  });

  let filesSaved = 0;
  // Duplicates are linked, not re-filed or re-quoted.
  if (jobId && decision.action !== "duplicate") {
    const emailName = shortEmailName(msg.subject, decision.action === "attach_to_job" ? "Reply" : "RFQ");
    const emailPath = storagePath(tenantId, jobId, "4. Correspondence", emailName);
    await store.putFile(emailPath, new TextEncoder().encode(emailAsText(msg)), "text/plain");
    filesSaved++;

    for (const f of files) {
      const path = storagePath(tenantId, jobId, "0. Incoming", f.name);
      await store.putFile(path, f.bytes, f.type);
      await store.saveAttachment({
        tenant_id: tenantId, job_id: jobId, filename: f.name, mime: f.type, size_bytes: f.bytes.byteLength,
        sha256: f.hash, storage_path: path, read_ok: null,
      });
      filesSaved++;
    }
    await store.enqueueDraft(tenantId, jobId);
  }

  if (label && labels.length) await mailbox.addCategories(msg.id, [], labels);

  return { action: decision.action, category: sort.category, jobId, quoteNo, filesSaved, skipped, labels: label ? labels : [] };
}

/** A mailbox port for an email already in hand (uploaded or forwarded): no remote calls. */
export function inMemoryMailbox(message: IncomingMessage, files: Map<string, Uint8Array>): MailboxPort {
  return {
    getMessage: async () => message,
    downloadAttachment: async (_mid, aid) => {
      const bytes = files.get(aid);
      if (!bytes) throw new Error(`Attachment ${aid} missing.`);
      return bytes;
    },
    addCategories: async () => {},
  };
}
