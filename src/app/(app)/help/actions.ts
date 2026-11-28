"use server";

import { revalidatePath } from "next/cache";
import { requireTenant } from "@/lib/tenant";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmail } from "@/lib/mail/send";
import { stripeClient } from "@/lib/stripe";
import { appUrl } from "@/lib/app-url";

export type HelpState = { ok: boolean; message: string } | null;
const TOPICS = ["Question", "Something's not working", "Idea", "Billing", "Closing my account"] as const;
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");

async function tellSupport(subject: string, body: string, replyTo: string | null) {
  const to = (process.env.SUPPORT_EMAIL || process.env.ALERT_EMAIL || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!to.length) return;
  await sendEmail({ fromName: "quoteout help", replyTo, to, cc: [], subject, text: body, html: `<pre style="font-family:Arial,sans-serif;font-size:14px;white-space:pre-wrap">${esc(body)}</pre>`, attachments: [] }).catch(() => null);
}

/** A question or problem, sent to quoteout from inside the app. */
export async function sendHelp(_: HelpState, f: FormData): Promise<HelpState> {
  const ctx = await requireTenant();
  const topic = TOPICS.find((t) => t === f.get("topic")) ?? "Question";
  const message = String(f.get("message") ?? "").trim().slice(0, 5000);
  const page = String(f.get("page") ?? "").slice(0, 300) || null;
  if (message.length < 5) return { ok: false, message: "Tell us a bit more." };
  const admin = createAdminClient();
  const since = new Date(Date.now() - 3600_000).toISOString();
  const { count } = await admin.from("support_requests").select("id", { count: "exact", head: true }).eq("tenant_id", ctx.tenant.id).gte("created_at", since);
  if ((count ?? 0) >= 10) return { ok: false, message: "You've sent a few already. We'll get back to you soon." };
  const { error } = await admin.from("support_requests").insert({ tenant_id: ctx.tenant.id, user_id: ctx.userId, email: ctx.email, topic, message, page });
  if (error) return { ok: false, message: "Couldn't send it just now. Please try again." };
  await tellSupport(`[${topic}] ${ctx.tenant.name}`, `From: ${ctx.email ?? "-"} (${ctx.tenant.name}, ${ctx.role})\nPage: ${page ?? "-"}\n\n${message}\n\n${appUrl()}/admin/support`, ctx.email);
  return { ok: true, message: "Sent. We'll reply by email, usually within one business day." };
}

/** Ask to close the company's account: billing stops at the end of the paid period; data is deleted after 30 days. */
export async function requestClose(_: HelpState, f: FormData): Promise<HelpState> {
  const ctx = await requireTenant();
  if (ctx.role !== "admin") return { ok: false, message: "Only a client admin can close the account." };
  if (String(f.get("confirm") ?? "").trim().toLowerCase() !== ctx.tenant.name.trim().toLowerCase()) return { ok: false, message: `Type your company name (${ctx.tenant.name}) to confirm.` };
  const reason = String(f.get("reason") ?? "").trim().slice(0, 2000) || null;
  const admin = createAdminClient();
  const { data: t } = await admin.from("tenants").select("stripe_subscription_id").eq("id", ctx.tenant.id).single();
  const stripe = stripeClient();
  if (stripe && t?.stripe_subscription_id) {
    try { await stripe.subscriptions.update(t.stripe_subscription_id as string, { cancel_at_period_end: true }); }
    catch { return { ok: false, message: "Couldn't stop billing just now. Please try again, or use Help to ask us." }; }
  }
  await admin.from("tenants").update({ close_requested_at: new Date().toISOString(), close_reason: reason }).eq("id", ctx.tenant.id);
  await admin.from("audit_log").insert({ tenant_id: ctx.tenant.id, actor: ctx.userId, action: "account.close_requested", target: ctx.tenant.id, detail: { reason } });
  await tellSupport(`[Closing] ${ctx.tenant.name}`, `${ctx.email ?? "-"} asked to close ${ctx.tenant.name}.\nReason: ${reason ?? "-"}\nBilling: ${t?.stripe_subscription_id ? "set to stop at the end of the period" : "no subscription"}`, ctx.email);
  revalidatePath("/help");
  return { ok: true, message: "Done. Billing stops at the end of your paid period. Your data is deleted 30 days after that. Download it first if you want a copy." };
}

/** Changed their mind. */
export async function undoClose(): Promise<void> {
  const ctx = await requireTenant();
  if (ctx.role !== "admin") return;
  const admin = createAdminClient();
  const { data: t } = await admin.from("tenants").select("stripe_subscription_id").eq("id", ctx.tenant.id).single();
  const stripe = stripeClient();
  if (stripe && t?.stripe_subscription_id) await stripe.subscriptions.update(t.stripe_subscription_id as string, { cancel_at_period_end: false }).catch(() => null);
  await admin.from("tenants").update({ close_requested_at: null, close_reason: null }).eq("id", ctx.tenant.id);
  await (await createClient()).from("audit_log").insert({ tenant_id: ctx.tenant.id, actor: ctx.userId, action: "account.close_cancelled", target: ctx.tenant.id }).then(() => null, () => null);
  revalidatePath("/help");
}
