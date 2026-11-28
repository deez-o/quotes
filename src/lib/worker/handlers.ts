import { notifyDrafted } from "@/lib/rfq/notify";
import { syncXeroQuotes } from "@/lib/xero-conn";
/**
 * Wires the worker steps to real services: Supabase (service role) and
 * Microsoft Graph with the tenant's encrypted tokens.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { decryptToken, encryptToken } from "@/lib/crypto/tokens";
import { GraphMailbox } from "@/lib/mail/graph";
import { msConfigFromEnv, validAccessToken, type MsTokens } from "@/lib/microsoft/oauth";
import { processMessage, type MailboxPort } from "./process-message";
import type { Handlers, QueueJob } from "./run";
import { supabaseStore } from "./supabase-store";
import { processInbound, processUpload } from "./sent-in";
import { draftRfqQuote } from "@/lib/rfq/draft";

async function streamToBytes(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.byteLength;
  }
  const out = new Uint8Array(size);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

/** A Graph client for one mailbox connection, refreshing and re-saving tokens as needed. */
export async function graphForConnection(db: SupabaseClient, siteUrl: string, tenantId: string, connectionId: string) {
  const cfg = msConfigFromEnv(siteUrl);
  if (!cfg) throw new Error("MS_CLIENT_ID / MS_CLIENT_SECRET not set.");

  const { data: secret, error } = await db.from("connection_secrets").select("token_ciphertext")
    .eq("tenant_id", tenantId).eq("connection_id", connectionId).maybeSingle();
  if (error || !secret) throw new Error("No stored tokens for this connection. Reconnect the inbox.");

  let tokens = JSON.parse(decryptToken(tenantId, secret.token_ciphertext as string)) as MsTokens;
  const token = async () =>
    validAccessToken(cfg, tokens, async (fresh) => {
      tokens = fresh;
      await db.from("connection_secrets").update({
        token_ciphertext: encryptToken(tenantId, JSON.stringify(fresh)),
        expires_at: new Date(fresh.expires_at).toISOString(),
        updated_at: new Date().toISOString(),
      }).eq("tenant_id", tenantId).eq("connection_id", connectionId);
    });

  return new GraphMailbox(token);
}

function mailboxPort(g: GraphMailbox): MailboxPort {
  return {
    getMessage: (id) => g.getMessage(id),
    downloadAttachment: async (mid, aid) => streamToBytes(await g.downloadAttachment(mid, aid)),
    addCategories: (mid, existing, add) => g.addCategories(mid, existing, add),
  };
}

export function buildHandlers(db: SupabaseClient, siteUrl: string): Handlers {
  const store = supabaseStore(db);

  return {
    async process_message(job: QueueJob) {
      const connectionId = String(job.payload.connection_id);
      const messageId = String(job.payload.message_id);
      const g = await graphForConnection(db, siteUrl, job.tenant_id, connectionId);
      await processMessage({ tenantId: job.tenant_id, connectionId, messageId }, mailboxPort(g), store);
      await db.from("connections").update({ status: "ok", last_ok_at: new Date().toISOString(), last_error: null })
        .eq("tenant_id", job.tenant_id).eq("id", connectionId);
    },

    async renew_watch(job: QueueJob) {
      await renewWatch(db, siteUrl, job.tenant_id, String(job.payload.connection_id));
    },

    async catch_up(job: QueueJob) {
      const connectionId = String(job.payload.connection_id);
      const g = await graphForConnection(db, siteUrl, job.tenant_id, connectionId);
      const since = new Date(Date.now() - 48 * 3600 * 1000);
      const { value } = await g.listInboxSince(since);
      const rows = value.map((m) => ({
        tenant_id: job.tenant_id, kind: "process_message" as const,
        payload: { connection_id: connectionId, message_id: m.id }, dedupe_key: `${connectionId}:${m.id}`,
      }));
      if (rows.length) {
        await db.from("queue_jobs").upsert(rows, { onConflict: "tenant_id,dedupe_key", ignoreDuplicates: true });
      }
    },

    async process_upload(job: QueueJob) {
      await processUpload(db, store, job.tenant_id, job.payload as { upload_id: string; paths: string[]; pasted_text?: string; uploader: string });
    },

    async process_inbound(job: QueueJob) {
      await processInbound(db, store, job.tenant_id, job.payload as { path: string; inbound_id: string });
    },

    async xero_sync(job: QueueJob) {
      // Quotes the customer accepted or declined in Xero.
      await syncXeroQuotes(db, job.tenant_id);
    },

    async draft_quote(job: QueueJob) {
      // Read the RFQ and its files, and turn it into a priced draft quote for the estimator to check.
      const out = await draftRfqQuote(db, job.tenant_id, String(job.payload.job_id));
      if (out.kind === "drafted") await notifyDrafted(db, job.tenant_id, out.siteQuoteId, "drafted", out.questions);
      else if (out.kind === "follow_up") await notifyDrafted(db, job.tenant_id, out.siteQuoteId, "follow_up");
    },
  };
}

/** Extend a mailbox subscription by two days, or create a new one if Microsoft removed it. */
export async function renewWatch(db: SupabaseClient, siteUrl: string, tenantId: string, connectionId: string) {
  const clientState = process.env.GRAPH_CLIENT_STATE;
  if (!clientState) throw new Error("GRAPH_CLIENT_STATE not set.");
  const g = await graphForConnection(db, siteUrl, tenantId, connectionId);
  const expires = new Date(Date.now() + 2 * 24 * 3600 * 1000);

  const { data: watch } = await db.from("mail_watches").select("id, subscription_id")
    .eq("tenant_id", tenantId).eq("connection_id", connectionId).maybeSingle();

  try {
    if (!watch?.subscription_id) throw new Error("no subscription");
    const r = await g.renewSubscription(watch.subscription_id as string, expires);
    await db.from("mail_watches").update({ expires_at: r.expirationDateTime, updated_at: new Date().toISOString() })
      .eq("tenant_id", tenantId).eq("id", watch.id as string);
  } catch {
    const sub = await g.createInboxSubscription(`${siteUrl}/api/webhooks/graph`, clientState, expires);
    if (watch?.id) {
      await db.from("mail_watches").update({ subscription_id: sub.id, expires_at: sub.expirationDateTime, updated_at: new Date().toISOString() })
        .eq("tenant_id", tenantId).eq("id", watch.id as string);
    } else {
      await db.from("mail_watches").insert({ tenant_id: tenantId, connection_id: connectionId, subscription_id: sub.id, expires_at: sub.expirationDateTime });
    }
    // Anything that arrived while the subscription was gone.
    await db.from("queue_jobs").insert({ tenant_id: tenantId, kind: "catch_up", payload: { connection_id: connectionId } });
  }
}
