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
import { fetchMicrosoftShare, fetchPublicLink, type DocLink } from "@/lib/rfq/links";

export async function runPortalFetch(db: SupabaseClient, tenantId: string, jobId: string, msToken?: () => Promise<{ token: string; canReadFiles: boolean } | null>): Promise<void> {
  const { data: q } = await db.from("site_quotes").select("id, rfq_summary, sent_at, portal_fetch").eq("tenant_id", tenantId).eq("job_id", jobId).maybeSingle();
  if (!q || q.sent_at) return;
  const summary = q.rfq_summary as RfqSummary | null;
  const portal = summary?.portal;
  if (!portal?.docsUrl) {
    if (summary?.links?.length) await runLinkFetch(db, tenantId, jobId, q.id as string, summary.links, q.portal_fetch as { notified?: boolean } | null, msToken);
    return;
  }
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


/** Documents behind SharePoint / OneDrive / Dropbox / Drive links. */
async function runLinkFetch(db: SupabaseClient, tenantId: string, jobId: string, quoteId: string, links: DocLink[], prev: { notified?: boolean } | null,
  msToken?: () => Promise<{ token: string; canReadFiles: boolean } | null>): Promise<void> {
  const at = new Date().toISOString();
  const got: { name: string; bytes: Uint8Array }[] = [];
  const problems: string[] = [];
  let reconnect = false;
  for (const l of links) {
    try {
      if (l.kind === "microsoft") {
        const ms = msToken ? await msToken() : null;
        if (!ms) { problems.push("SharePoint link: connect your Outlook (Microsoft 365) in Setup so quoteout can open it"); continue; }
        if (!ms.canReadFiles) { problems.push("SharePoint link: reconnect Outlook in Setup and allow file access"); reconnect = true; continue; }
        got.push(...await fetchMicrosoftShare(l.url, ms.token));
      } else {
        got.push(...await fetchPublicLink(l));
      }
    } catch (e) {
      problems.push(`${l.kind === "microsoft" ? "SharePoint" : l.kind === "dropbox" ? "Dropbox" : "Google Drive"} link: ${e instanceof Error ? e.message : "couldn't open it"}`);
    }
  }
  const { files, skipped } = await unpackFiles(got);
  const { added } = files.length ? await attachToJob(db, tenantId, jobId, files) : { added: 0 };
  const info = added
    ? { ok: true, at, source: "links", note: `Downloaded from the linked folder${links.length > 1 ? "s" : ""}.`, added, skipped: [...skipped, ...problems].slice(0, 10) }
    : { ok: false, at, source: "links", reason: reconnect ? "reconnect" : "links", message: problems.join(". ") || "Nothing readable in the linked documents.", notified: true };
  await db.from("site_quotes").update({ portal_fetch: info }).eq("tenant_id", tenantId).eq("id", quoteId);
  if (added) {
    await db.from("queue_jobs").insert({ tenant_id: tenantId, kind: "draft_quote", payload: { job_id: jobId, redo: true, portal_fetch: info } });
    await db.from("jobs").update({ status: "processing", updated_at: at }).eq("tenant_id", tenantId).eq("id", jobId);
  } else if (!prev?.notified) {
    await notifyDrafted(db, tenantId, quoteId, "portal_login", 0, info.message as string);
  }
}
