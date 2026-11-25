/**
 * StorePort backed by Supabase (service role). Every query filters by tenant_id.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { StorePort } from "./process-message";

export const BUCKET = "job-files";

export function supabaseStore(db: SupabaseClient): StorePort {
  return {
    async isSeen(tenantId, connectionId, messageId) {
      const { data } = await db.from("messages").select("id")
        .eq("tenant_id", tenantId).eq("connection_id", connectionId).eq("provider_message_id", messageId).maybeSingle();
      return Boolean(data);
    },

    async jobForConversation(tenantId, conversationId) {
      const { data } = await db.from("messages").select("job_id")
        .eq("tenant_id", tenantId).eq("thread_id", conversationId).not("job_id", "is", null)
        .order("created_at", { ascending: true }).limit(1).maybeSingle();
      return (data?.job_id as string | undefined) ?? null;
    },

    async jobForContentHash(tenantId, hash) {
      // Only recent jobs count as duplicates (same email sent twice), not an RFQ re-sent weeks later.
      const since = new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString();
      const { data } = await db.from("messages").select("job_id")
        .eq("tenant_id", tenantId).eq("content_hash", hash).not("job_id", "is", null).gte("created_at", since)
        .order("created_at", { ascending: true }).limit(1).maybeSingle();
      return (data?.job_id as string | undefined) ?? null;
    },

    async createJob(tenantId, input) {
      const { data: quoteNo, error: qErr } = await db.rpc("next_quote_number", { t: tenantId });
      if (qErr || !quoteNo) throw new Error(`Quote number: ${qErr?.message ?? "none returned"}`);
      const { data, error } = await db.from("jobs").insert({
        tenant_id: tenantId, module: input.module, quote_no: quoteNo, status: "processing",
        customer_name: null, site: input.subject.slice(0, 200),
      }).select("id").single();
      if (error || !data) throw new Error(`Create job: ${error?.message}`);
      await db.from("audit_log").insert({ tenant_id: tenantId, action: "job.created", target: quoteNo, detail: { from: input.from } });
      return { jobId: data.id as string, quoteNo: quoteNo as string };
    },

    async saveMessage(row) {
      const { error } = await db.from("messages").upsert(row, { onConflict: "connection_id,provider_message_id", ignoreDuplicates: true });
      if (error) throw new Error(`Save message: ${error.message}`);
    },

    async putFile(path, bytes, contentType) {
      if (!/^[0-9a-f-]{36}\//.test(path)) throw new Error("Storage path must start with the tenant id.");
      const { error } = await db.storage.from(BUCKET).upload(path, bytes, { contentType, upsert: true });
      if (error) throw new Error(`Upload ${path}: ${error.message}`);
    },

    async saveAttachment(row) {
      const { error } = await db.from("attachments").insert(row);
      if (error) throw new Error(`Save attachment: ${error.message}`);
    },

    async enqueueDraft(tenantId, jobId) {
      const { error } = await db.from("queue_jobs").insert({
        tenant_id: tenantId, kind: "draft_quote", payload: { job_id: jobId },
        // A revision re-drafts: no dedupe key, but run a minute later to let follow-ups settle.
        run_after: new Date(Date.now() + 60_000).toISOString(),
      });
      if (error) throw new Error(`Queue draft: ${error.message}`);
    },
  };
}
