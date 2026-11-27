"use server";

import { revalidatePath } from "next/cache";
import { requireTenant } from "@/lib/tenant";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadAccess } from "@/lib/access-load";
import { loadQuotePdf } from "@/lib/quote/pdf-load";
import { defaultSubject, fillMessage, fromName, messageHtml, parseAddresses, pdfName, type EmailFacts } from "@/lib/quote/email";
import { canSendEmail, sendEmail } from "@/lib/mail/send";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SENDS_PER_HOUR = 30;

async function senderName(): Promise<string | null> {
  const { data } = await (await createClient()).auth.getUser();
  const m = (data.user?.user_metadata ?? {}) as Record<string, unknown>;
  const n = [m.full_name, m.name].find((v) => typeof v === "string" && v.trim());
  return n ? String(n).trim().slice(0, 80) : null;
}

/** What the send box starts with: the customer's email, a subject and the company's message. */
export async function sendDraft(input: { id: string }): Promise<{ ok: true; to: string; subject: string; message: string; canSend: boolean; history: { to: string[]; at: string; by: string | null }[] } | { ok: false; message: string }> {
  const ctx = await requireTenant();
  if (!UUID.test(input.id)) return { ok: false, message: "Quote not found." };
  const db = await createClient();
  const got = await loadQuotePdf(db, ctx.tenant.id, input.id);
  if (!got) return { ok: false, message: "Quote not found." };
  const facts: EmailFacts = {
    business: got.brand.name, quoteNo: got.quote.quote_no, job: got.quote.title ?? "", customer: got.quote.customer_name,
    totalIncGst: got.data.totals.incGst, totalExGst: got.data.totals.exGst, sender: await senderName(), senderEmail: ctx.email, phone: got.brand.phone,
  };
  const { data: sends } = await db.from("quote_sends").select("to_addresses, created_at, sent_by_email, status").eq("tenant_id", ctx.tenant.id).eq("site_quote_id", input.id).eq("status", "sent").order("created_at", { ascending: false }).limit(5);
  return {
    ok: true, to: got.quote.customer_email ?? "", subject: defaultSubject(facts), message: fillMessage(got.emailTemplate, facts), canSend: canSendEmail(),
    history: (sends ?? []).map((s) => ({ to: s.to_addresses as string[], at: s.created_at as string, by: (s.sent_by_email as string | null) ?? null })),
  };
}

/** Email the quote PDF to the customer. Only ever runs when someone presses Send. */
export async function sendQuote(input: { id: string; to: string; cc: string; subject: string; message: string; copyMe: boolean }): Promise<{ ok: true; sentTo: string[] } | { ok: false; message: string }> {
  const ctx = await requireTenant();
  if (ctx.role === "viewer") return { ok: false, message: "Viewers can't send quotes." };
  if (!UUID.test(input.id)) return { ok: false, message: "Quote not found." };
  if (!canSendEmail()) return { ok: false, message: "Sending email isn't set up yet. Use PDF / print and attach it to your own email for now." };
  const { access } = await loadAccess(ctx.tenant.id);
  if (access.state === "locked") return { ok: false, message: access.message };

  const to = parseAddresses(String(input.to ?? ""), 10);
  const cc = parseAddresses(String(input.cc ?? ""), 5);
  if (to.invalid.length || cc.invalid.length) return { ok: false, message: `Check ${[...to.invalid, ...cc.invalid].join(", ")}: that doesn't look like an email address.` };
  if (to.tooMany || cc.tooMany) return { ok: false, message: "That's a lot of people. Send to 10 at most, with 5 copied." };
  if (!to.valid.length) return { ok: false, message: "Add the customer's email address." };
  const subject = String(input.subject ?? "").replace(/[\r\n]+/g, " ").trim().slice(0, 200);
  const message = String(input.message ?? "").replace(/\r/g, "").trim().slice(0, 10_000);
  if (!subject) return { ok: false, message: "Add a subject." };
  if (message.length < 5) return { ok: false, message: "Add a message for the customer." };

  const db = await createClient();
  const admin = createAdminClient();
  const since = new Date(Date.now() - 3600_000).toISOString();
  const { count } = await admin.from("quote_sends").select("id", { count: "exact", head: true }).eq("tenant_id", ctx.tenant.id).gte("created_at", since);
  if ((count ?? 0) >= SENDS_PER_HOUR) return { ok: false, message: "That's a lot of quotes sent in the last hour. Try again a bit later." };

  const got = await loadQuotePdf(db, ctx.tenant.id, input.id);
  if (!got) return { ok: false, message: "Quote not found." };
  if (!got.data.lines.length || got.data.totals.exGst <= 0) return { ok: false, message: "This quote has no priced lines yet. Price it before sending." };

  const ccList = [...cc.valid];
  if (input.copyMe && ctx.email && !to.valid.includes(ctx.email.toLowerCase()) && !ccList.includes(ctx.email.toLowerCase())) ccList.push(ctx.email.toLowerCase());
  const replyTo = got.brand.email || ctx.email;
  const pdf = await got.pdf();
  const sent = await sendEmail({
    fromName: fromName(got.brand.name), replyTo, to: to.valid, cc: ccList, subject, text: message,
    html: messageHtml(message, got.brand.name, got.data.brand), attachments: [{ filename: pdfName(got.quote.quote_no, got.quote.title ?? ""), content: pdf }],
  });

  await admin.from("quote_sends").insert({
    tenant_id: ctx.tenant.id, site_quote_id: input.id, to_addresses: to.valid, cc_addresses: ccList, subject, message,
    total_ex_gst: got.data.totals.exGst, sent_by: ctx.userId, sent_by_email: ctx.email, provider_id: sent.ok ? sent.id : null,
    status: sent.ok ? "sent" : "failed", error: sent.ok ? null : sent.message,
  });
  if (!sent.ok) return { ok: false, message: sent.message };

  const now = new Date().toISOString();
  await admin.from("site_quotes").update({ status: "sent", sent_at: now }).eq("tenant_id", ctx.tenant.id).eq("id", input.id).eq("status", "draft");
  await admin.from("site_quotes").update({ sent_at: now }).eq("tenant_id", ctx.tenant.id).eq("id", input.id);
  await admin.from("audit_log").insert({ tenant_id: ctx.tenant.id, actor: ctx.userId, action: "quote.emailed", target: input.id, detail: { to: to.valid, cc: ccList } });
  revalidatePath(`/site/${input.id}`);
  revalidatePath("/quotes");
  return { ok: true, sentTo: to.valid };
}
