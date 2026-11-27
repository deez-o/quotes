/** The email that goes with a quote: addresses, subject, message. Pure, so it can be tested. */

const EMAIL = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[a-z]{2,}$/i;

/** Addresses typed or pasted in any common way: commas, semicolons, spaces, new lines, "Name <a@b.com>". */
export function parseAddresses(input: string, max = 10): { valid: string[]; invalid: string[]; tooMany: boolean } {
  const parts = input.split(/[,;\s]+/).map((p) => p.trim().replace(/^.*<([^>]+)>.*$/, "$1").replace(/^[<"'(]+|[>"')]+$/g, "")).filter(Boolean);
  const valid: string[] = [];
  const invalid: string[] = [];
  for (const p of parts) {
    if (!p.includes("@")) continue; // names around an address, e.g. "Sam Turner <sam@x.com>"
    const a = p.toLowerCase();
    if (!EMAIL.test(a)) invalid.push(p);
    else if (!valid.includes(a)) valid.push(a);
  }
  return { valid: valid.slice(0, max), invalid, tooMany: valid.length > max };
}

export type EmailFacts = {
  business: string; quoteNo: string | null; job: string; customer: string | null; totalIncGst: number; totalExGst: number;
  sender: string | null; senderEmail: string | null; phone: string | null;
  /** When the customer is given options: each one's name and total. */
  options?: { label: string | null; title: string; incGst: number }[];
};

export const DEFAULT_QUOTE_MESSAGE = `Hi {customer},

Thanks for the opportunity to quote. Please find attached our quote {quote_no} for {job}.

{price_summary} The quote PDF has the full breakdown and our terms.

If you'd like to go ahead, you can accept online using the button below. Any questions, just reply to this email{phone_line}.

Kind regards,
{sender}
{business}`;

const money = (n: number) => `$${(Math.round(n * 100) / 100).toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const firstName = (s: string | null) => {
  const t = (s ?? "").trim();
  if (!t) return "there";
  // A company name ("Acme Builders Pty Ltd") reads fine whole; a person's name gets their first name.
  return /\b(pty|ltd|limited|council|group|builders?|construction|services|inc)\b/i.test(t) ? t : t.split(/\s+/)[0];
};

export function priceSummary(f: Pick<EmailFacts, "totalIncGst" | "totalExGst" | "options">): string {
  const o = f.options ?? [];
  if (o.length > 1) {
    const parts = o.map((x) => `Option ${x.label ?? ""} (${x.title}) is ${money(x.incGst)}`);
    return `We've priced ${o.length} options: ${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}, all inc GST.`;
  }
  return `The total is ${money(f.totalIncGst)} inc GST (${money(f.totalExGst)} ex GST).`;
}

export function defaultSubject(f: Pick<EmailFacts, "business" | "quoteNo" | "job">): string {
  return [`Quote${f.quoteNo ? ` ${f.quoteNo}` : ""}`, f.job, f.business].filter(Boolean).join(" - ").slice(0, 200);
}

/** The company's wording (or ours) with the placeholders filled in. */
export function fillMessage(template: string | null | undefined, f: EmailFacts): string {
  const t = template?.trim() || DEFAULT_QUOTE_MESSAGE;
  const vals: Record<string, string> = {
    customer: firstName(f.customer), quote_no: f.quoteNo ?? "", job: f.job || "the job", total: money(f.totalIncGst), total_ex: money(f.totalExGst),
    business: f.business, sender: f.sender || f.business, phone: f.phone ?? "", phone_line: f.phone ? ` or call ${f.phone}` : "",
    price_summary: priceSummary(f),
  };
  return t.replace(/\{(\w+)\}/g, (m, k: string) => (k in vals ? vals[k] : m)).replace(/ +([.,])/g, "$1").replace(/\n{3,}/g, "\n\n").trim();
}

const onColour = (h: string) => {
  const c = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2] > 0.45 ? "#16181B" : "#FFFFFF";
};
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** A plain, readable HTML version of the message, with the company's colour as a thin bar. */
export function messageHtml(message: string, business: string, brand: string, acceptUrl: string | null = null): string {
  const colour = /^#[0-9a-f]{6}$/i.test(brand) ? brand : "#16181B";
  const paras = message.split(/\n{2,}/).map((p) => `<p style="margin:0 0 14px">${esc(p).replace(/\n/g, "<br>")}</p>`).join("");
  return `<!doctype html><html><body style="margin:0;padding:24px;background:#f5f6f7;font-family:Arial,Helvetica,sans-serif;color:#1c1f23;font-size:15px;line-height:1.5">
<div style="max-width:600px;margin:0 auto;background:#fff;border-radius:6px;overflow:hidden;border:1px solid #e1e4e8">
<div style="height:6px;background:${colour}"></div>
<div style="padding:24px 28px">${paras}${acceptUrl ? `<p style="margin:22px 0 4px"><a href="${esc(acceptUrl)}" style="display:inline-block;background:${colour};color:${onColour(colour)};text-decoration:none;font-weight:bold;padding:12px 22px;border-radius:6px">View and accept quote</a></p>` : ""}</div>
</div>
<p style="max-width:600px;margin:12px auto 0;font-size:12px;color:#7a8089;text-align:center">Quote from ${esc(business)}, sent using quoteout.</p>
</body></html>`;
}

/** The plain-text email: the message, then the accept link. */
export const messageText = (message: string, acceptUrl: string | null) => (acceptUrl ? `${message}\n\nView and accept the quote: ${acceptUrl}\n` : message);

/** A display name safe for the From header. */
export const fromName = (s: string) => s.replace(/[\r\n]+/g, " ").replace(/["<>\\]/g, "").replace(/\s+/g, " ").trim().slice(0, 70) || "quoteout";

/** A safe PDF file name. */
export const pdfName = (quoteNo: string | null, job: string) => `${[`Quote ${quoteNo ?? ""}`.trim(), job].filter(Boolean).join(" - ")}`.replace(/[^\w.\- ()&,]+/g, "_").slice(0, 120) + ".pdf";
