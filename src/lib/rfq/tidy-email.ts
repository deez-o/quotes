/**
 * An RFQ email cut down to what matters for the quote: the message itself, without signatures,
 * logos, disclaimers, "external email" banners, link addresses and our own forwarding wrapper.
 * Each email in a forwarded chain is kept, as its own part, so nothing about the job is lost.
 */

export type EmailPart = { from: string | null; date: string | null; subject: string | null; text: string };

const SIGN_OFF = /^\s*(kind regards|warm regards|best regards|regards|many thanks|thanks( again| and regards)?|thank you|cheers|sincerely|yours (faithfully|sincerely))\b[,.!]*\s*$/i;
const DISCLAIMER = /(this (e-?mail|message|communication)[^.\n]{0,80}(confidential|privileged|intended (only )?for)|intended recipient|if you (have )?received this (e-?mail|message) in error|please consider the environment before printing|scanned for viruses|disclaimer:|liability limited by a scheme)/i;
const BANNER = /^\s*(\[?external\]?|caution:|warning:|this email originated from outside|you don'?t often get email from|some people who received this message don'?t often)/i;
const HEADER = /^[ \t>*]*From:[ \t*]*(.+)\n((?:[ \t>*]*(?:Sent|Date|To|Cc|Subject|Importance)[ \t*]*:.*\n){1,6})/m;
/** Contact lines that make up a signature block. */
const CONTACT = /(^|\s)(m|p|t|ph|mob|mobile|phone|e|w|a|f|fax|office|direct)\s*[:|.]|\b(0[2-478]\d{8}|0[2-478]\s?\d{4}\s?\d{4}|04\d{2}\s?\d{3}\s?\d{3}|\+61)|www\.|https?:\/\/|@[\w-]+\.(com|net|org|au)|\b(pty|ltd|abn)\b|\b(qld|nsw|vic|sa|wa|tas|nt|act)\s+\d{4}\b|linkedin|facebook|instagram/i;

function clean(text: string): string {
  let t = text.replace(/\r/g, "")
    // Pictures and link targets: "[cid:image001.png@01D...]", "<https://...>", "<mailto:...>", "[https://...]"
    .replace(/\[cid:[^\]]*\]/gi, "")
    .replace(/<(https?:|mailto:)[^>]*>/gi, "")
    .replace(/\[(https?:|mailto:)[^\]]*\]/gi, "")
    .replace(/ /g, " ");
  const lines = t.split("\n").filter((l) => !BANNER.test(l));
  // Stop at the disclaimer.
  const d = lines.findIndex((l) => DISCLAIMER.test(l));
  let keep = d >= 0 ? lines.slice(0, d) : lines;
  // Signature: drop the sign-off and everything under it (name, title, phone, logos).
  const s = keep.findIndex((l) => SIGN_OFF.test(l));
  if (s >= 0) {
    keep = keep.slice(0, s);
  } else {
    // No sign-off: trim a trailing block of contact lines.
    let end = keep.length;
    while (end > 0 && (!keep[end - 1].trim() || CONTACT.test(keep[end - 1]) || keep[end - 1].trim().length < 40 && end > keep.length - 8 && keep.slice(end - 3, end).some((l) => CONTACT.test(l)))) end--;
    keep = keep.slice(0, end);
  }
  // The greeting ("Hi Dan,", "Good morning all,") says nothing about the job.
  const g = keep.findIndex((l) => l.trim());
  if (g >= 0 && /^\s*(hi|hello|hey|good (morning|afternoon|day)|dear|g'?day)\b[^.\n]{0,30}[,!]?\s*$/i.test(keep[g])) keep = keep.slice(g + 1);
  t = keep.map((l) => l.replace(/[ \t]+$/g, "")).join("\n");
  return t.replace(/\n{3,}/g, "\n\n").trim();
}

/** Splits a body into the emails it holds (newest first) and tidies each one. */
export function tidyEmail(body: string): EmailPart[] {
  const parts: EmailPart[] = [];
  let rest = body.replace(/\r/g, "");
  let head: Omit<EmailPart, "text"> = { from: null, date: null, subject: null };
  for (let i = 0; i < 12; i++) {
    const m = HEADER.exec(rest);
    const field = (block: string, k: string) => new RegExp(`^[ \\t>*]*${k}[ \\t*]*:[ \\t*]*(.*)$`, "mi").exec(block)?.[1]?.replace(/\*/g, "").trim() || null;
    if (!m || !(field(m[2], "Sent") || field(m[2], "Date") || field(m[2], "Subject"))) break;
    const text = clean(rest.slice(0, m.index).replace(/^-+ ?(Forwarded message|Original Message) ?-+\s*$/gim, ""));
    if (text) parts.push({ ...head, text });
    head = {
      from: m[1].replace(/\*/g, "").replace(/<[^>]*>|\[mailto:[^\]]*\]/gi, "").replace(/["']/g, "").trim() || null,
      date: field(m[2], "Sent") ?? field(m[2], "Date"),
      subject: field(m[2], "Subject"),
    };
    rest = rest.slice(m.index + m[0].length);
  }
  const text = clean(rest);
  if (text) parts.push({ ...head, text });
  return parts;
}
