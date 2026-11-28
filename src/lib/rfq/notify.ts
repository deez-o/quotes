import type { SupabaseClient } from "@supabase/supabase-js";
import { sendEmail } from "@/lib/mail/send";
import { appUrl } from "@/lib/app-url";
import { quoteLabel } from "@/lib/quote/numbering";

/**
 * Tell the company a forwarded RFQ has been drafted and is ready to check. Goes to the
 * business email in Setup, or the client admins if there isn't one. Off with notify_drafts.
 */
export async function notifyDrafted(db: SupabaseClient, tenantId: string, siteQuoteId: string, kind: "drafted" | "follow_up", questions = 0): Promise<void> {
  try {
    const [{ data: s }, { data: q }] = await Promise.all([
      db.from("tenant_settings").select("notify_drafts, business_email").eq("tenant_id", tenantId).maybeSingle(),
      db.from("site_quotes").select("quote_no, revision, title, customer_name, total_ex_gst").eq("tenant_id", tenantId).eq("id", siteQuoteId).maybeSingle(),
    ]);
    if (!q || s?.notify_drafts === false) return;
    let to = s?.business_email ? [String(s.business_email)] : [];
    if (!to.length) {
      const { data: admins } = await db.from("memberships").select("user_id").eq("tenant_id", tenantId).eq("role", "admin").is("disabled_at", null).limit(5);
      for (const a of admins ?? []) {
        const { data: u } = await db.auth.admin.getUserById(a.user_id as string);
        if (u.user?.email) to.push(u.user.email);
      }
    }
    to = [...new Set(to.map((e) => e.toLowerCase()))];
    if (!to.length) return;
    const label = quoteLabel(q);
    const link = `${appUrl()}/site/${siteQuoteId}`;
    const total = q.total_ex_gst == null ? null : `$${Math.round(Number(q.total_ex_gst)).toLocaleString("en-AU")} ex GST`;
    const lines = kind === "drafted"
      ? [`quoteout has drafted ${label}: ${q.title ?? "RFQ"}${q.customer_name ? ` for ${q.customer_name}` : ""}.`, total ? `Draft price: ${total}.` : "", questions ? `${questions} thing${questions === 1 ? "" : "s"} to confirm before it goes out.` : "Nothing flagged to confirm.", "", `Check it: ${link}`]
      : [`Another email came in on ${label}: ${q.title ?? "RFQ"}. Check whether it changes the quote.`, "", `Open it: ${link}`];
    const text = lines.filter((l, i, a) => l !== "" || a[i - 1] !== "").join("\n");
    await sendEmail({
      fromName: "quoteout", replyTo: null, to, cc: [],
      subject: kind === "drafted" ? `Ready to check: ${label} ${q.title ?? ""}`.trim() : `New email on ${label}`,
      text, html: `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.5">${text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/\n/g, "<br>").replace(link, `<a href="${link}">${link}</a>`)}</div>
<p style="font-size:12px;color:#7a8089">Turn these emails off in Setup → Costs → pricing settings.</p>`,
      attachments: [],
    });
  } catch {
    // A missed notification mustn't fail the draft.
  }
}
