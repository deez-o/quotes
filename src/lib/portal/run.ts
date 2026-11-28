/**
 * The portal_fetch job: download a tender's documents with the saved portal login,
 * attach them to the RFQ and read it again. If there's no login or it fails, say so on
 * the quote and email the company once.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { RfqSummary } from "@/lib/rfq/split";
import { attachToJob, unpackFiles } from "@/lib/rfq/attach";
import { notifyDrafted } from "@/lib/rfq/notify";
import { fetchPortalDocs } from "./fetch";
import { loadPortalLogin, providerFor } from "./logins";

export async function runPortalFetch(db: SupabaseClient, tenantId: string, jobId: string): Promise<void> {
  const { data: q } = await db.from("site_quotes").select("id, rfq_summary, sent_at, portal_fetch").eq("tenant_id", tenantId).eq("job_id", jobId).maybeSingle();
  const portal = (q?.rfq_summary as RfqSummary | null)?.portal;
  if (!q || !portal?.docsUrl || q.sent_at) return;
  const provider = providerFor(portal.portal);
  const login = provider ? await loadPortalLogin(db, tenantId, provider) : null;
  const at = new Date().toISOString();

  const r = await fetchPortalDocs(portal.docsUrl, login ? { username: login.username, password: login.password } : null);
  if (!r.ok) {
    const firstTime = !(q.portal_fetch as { notified?: boolean } | null)?.notified;
    await db.from("site_quotes").update({ portal_fetch: { ok: false, at, reason: r.reason, message: r.message, notified: true } }).eq("tenant_id", tenantId).eq("id", q.id);
    if (login && (r.reason === "login_failed" || r.reason === "two_step")) {
      await db.from("connections").update({ status: "error", last_error: r.message.slice(0, 200) }).eq("id", login.connectionId).eq("tenant_id", tenantId);
    }
    if (firstTime) await notifyDrafted(db, tenantId, q.id as string, "portal_login", 0, r.message);
    return;
  }

  const { files, skipped } = await unpackFiles(r.files);
  const { added } = files.length ? await attachToJob(db, tenantId, jobId, files) : { added: 0 };
  if (login) await db.from("connections").update({ status: "ok", last_error: null, last_ok_at: at }).eq("id", login.connectionId).eq("tenant_id", tenantId);
  const fetchInfo = { ok: true, at, note: r.note, added, skipped: skipped.slice(0, 10) };
  await db.from("site_quotes").update({ portal_fetch: fetchInfo }).eq("tenant_id", tenantId).eq("id", q.id);
  if (added > 0) {
    // Read it again with the documents. The redo keeps portal_fetch by passing it on.
    await db.from("queue_jobs").insert({ tenant_id: tenantId, kind: "draft_quote", payload: { job_id: jobId, redo: true, portal_fetch: fetchInfo } });
    await db.from("jobs").update({ status: "processing", updated_at: at }).eq("tenant_id", tenantId).eq("id", jobId);
  }
}
