"use server";

import { headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { findByToken } from "@/lib/quote/accept";
import { quoteLabel } from "@/lib/quote/numbering";
import { sendEmail } from "@/lib/mail/send";
import { appUrl } from "@/lib/app-url";
import { loadBrand } from "@/lib/sheet/store";
import { acceptedHtml } from "@/lib/quote/email";

export type AcceptState = { ok: boolean; message: string } | null;

const clean = (v: FormDataEntryValue | null, n: number) => String(v ?? "").replace(/[\u0000-\u0008\u000b-\u001f]/g, "").trim().slice(0, n);
const money = (n: number) => `$${n.toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** The customer accepts the quote (one option, if there are several). */
export async function acceptQuote(_: AcceptState, form: FormData): Promise<AcceptState> {
  const token = clean(form.get("token"), 64);
  const optionId = clean(form.get("option"), 40);
  const name = clean(form.get("name"), 120);
  const po = clean(form.get("po"), 80);
  const note = clean(form.get("note"), 2000);
  if (form.get("website")) return { ok: false, message: "Something went wrong. Please try again." }; // bots fill hidden fields
  if (name.length < 2) return { ok: false, message: "Please type your name." };
  if (form.get("agree") !== "on") return { ok: false, message: "Please tick the box to accept the quote and its terms." };

  const admin = createAdminClient();
  const found = await findByToken(admin, token);
  if (!found) return { ok: false, message: "This quote link isn't valid." };
  if (found.superseded) return { ok: false, message: "This quote has been replaced by a newer version. Please use the latest one you were sent." };
  if (found.accepted) return { ok: false, message: "This quote has already been accepted." };
  const chosen = found.group.find((g) => g.id === (optionId || found.group[0].id));
  if (!chosen) return { ok: false, message: "Please choose an option." };

  const h = await headers();
  const ip = (h.get("x-forwarded-for") ?? "").split(",")[0].trim() || null;
  const now = new Date().toISOString();
  const { data: updated } = await admin.from("site_quotes")
    .update({ status: "won", accepted_at: now, accepted_name: name, accepted_po: po || null, accepted_note: note || null })
    .eq("tenant_id", found.tenantId).eq("id", chosen.id).is("accepted_at", null).select("id");
  if (!updated?.length) return { ok: false, message: "This quote has already been accepted." };
  const others = found.group.filter((g) => g.id !== chosen.id).map((g) => g.id);
  if (others.length) await admin.from("site_quotes").update({ status: "lost" }).eq("tenant_id", found.tenantId).in("id", others).neq("status", "won");
  await admin.from("audit_log").insert({ tenant_id: found.tenantId, actor: null, action: "quote.accepted", target: chosen.id, detail: { name, po: po || null, ip, option: chosen.option_label } });

  // Tell the people who sent it, and the business address.
  const [{ data: sends }, brand] = await Promise.all([
    admin.from("quote_sends").select("sent_by_email").eq("tenant_id", found.tenantId).in("site_quote_id", found.group.map((g) => g.id)).eq("status", "sent").order("created_at", { ascending: false }).limit(5),
    loadBrand(admin, found.tenantId),
  ]);
  const to = [...new Set([...(sends ?? []).map((s) => s.sent_by_email as string | null), brand.email].filter((e): e is string => Boolean(e)).map((e) => e.toLowerCase()))];
  if (to.length) {
    const label = `${quoteLabel(found.lead, false)}${found.group.length > 1 ? ` Option ${chosen.option_label}` : ""}`;
    const total = chosen.costing?.priceExGst ?? Number(chosen.total_ex_gst ?? 0);
    const lines = [
      `${name}${found.lead.customer_name ? ` (${found.lead.customer_name})` : ""} has accepted quote ${label}: ${chosen.title ?? ""}.`,
      ``, `Price: ${money(total)} ex GST`, po ? `PO number: ${po}` : "", note ? `Their note: ${note}` : "", ``,
      `Open the quote: ${appUrl()}/site/${chosen.id}`,
    ].filter((l, i, a) => l !== "" || a[i - 1] !== "");
    await sendEmail({
      fromName: "quoteout", replyTo: null, to, cc: [], subject: `Accepted: ${label} – ${chosen.title ?? ""} (${money(total)} ex GST)`,
      text: lines.join("\n"),
      html: acceptedHtml({
        label, title: chosen.title ?? "", customer: found.lead.customer_name ?? null, acceptedBy: name,
        exGst: total, incGst: Math.round(total * (1 + brand.gstPercent / 100) * 100) / 100,
        po: po || null, note: note || null, site: found.lead.site_address ?? null,
        quoteUrl: `${appUrl()}/site/${chosen.id}`, business: brand.name,
      }), attachments: [],
    }).catch(() => null);
  }
  return { ok: true, message: "Accepted" };
}
