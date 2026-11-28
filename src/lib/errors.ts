import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmail } from "@/lib/mail/send";
import { appUrl } from "@/lib/app-url";

export type ErrorReport = { where: "server" | "browser" | "worker"; message: string; digest?: string | null; path?: string | null; tenantId?: string | null; userId?: string | null; detail?: Record<string, unknown> };

/** Errors that are expected noise, not faults (e.g. Next.js redirects and not-found). */
const IGNORE = /NEXT_REDIRECT|NEXT_NOT_FOUND|NEXT_HTTP_ERROR_FALLBACK|AbortError|The user aborted a request/i;

/**
 * Keep the error for quoteout staff (Admin → Errors), and email ALERT_EMAIL the first time a
 * given error shows up in 30 minutes. Never throws: reporting must not cause a second failure.
 */
export async function recordError(e: ErrorReport): Promise<void> {
  try {
    const message = String(e.message ?? "").slice(0, 2000) || "Unknown error";
    if (IGNORE.test(message)) return;
    const admin = createAdminClient();
    const since = new Date(Date.now() - 30 * 60_000).toISOString();
    const { count } = await admin.from("app_errors").select("id", { count: "exact", head: true }).eq("message", message).gte("created_at", since);
    await admin.from("app_errors").insert({
      where_from: e.where, message, digest: e.digest?.slice(0, 100) ?? null, path: e.path?.slice(0, 500) ?? null,
      tenant_id: e.tenantId ?? null, user_id: e.userId ?? null, detail: e.detail ?? null,
    });
    const to = process.env.ALERT_EMAIL;
    if (!to || (count ?? 0) > 0) return;
    await sendEmail({
      fromName: "quoteout alerts", replyTo: null, to: to.split(",").map((s) => s.trim()).filter(Boolean), cc: [],
      subject: `quoteout error: ${message.slice(0, 90)}`,
      text: `Where: ${e.where}\nPage: ${e.path ?? "-"}\nCompany: ${e.tenantId ?? "-"}\nDigest: ${e.digest ?? "-"}\n\n${message}\n\nAll errors: ${appUrl()}/admin/errors`,
      html: `<pre style="font-size:13px;white-space:pre-wrap">${`Where: ${e.where}\nPage: ${e.path ?? "-"}\nCompany: ${e.tenantId ?? "-"}\nDigest: ${e.digest ?? "-"}\n\n${message}`.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</pre><p><a href="${appUrl()}/admin/errors">All errors</a></p>`,
      attachments: [],
    });
  } catch {
    // Reporting failed; nothing more to do.
  }
}
