import { isPortalCodeEmail } from "@/lib/portal/otp";
/**
 * Inbox sorting and job linking. Cheap, explainable rules first; anything the
 * rules are unsure about is marked for the AI to sort (confident=false).
 */
import { createHash } from "node:crypto";
import type { Category, IncomingAttachment, IncomingMessage } from "./types";

export type SortResult = { category: Category; confident: boolean; reason: string };

const has = (text: string, words: RegExp) => words.test(text);

const AWARD = /\b(successful (tender|quote)|you have been (awarded|successful)|been awarded|award(ed)? (letter|of contract)|letter of acceptance|purchase order (attached|no\.?|#)|po (attached|number))\b/i;
const INVOICE = /\b(tax invoice|invoice (no\.?|#|number)|inv-\d+|remittance advice|statement of account|amount due)\b/i;
const JUNK = /\b(unsubscribe|newsletter|webinar|view (this email )?in (your )?browser|special offer)\b/i;
const RFQ = /\b(rfq|request for (a )?(quote|quotation|pricing|tender)|invit(ed|ation) to (tender|quote)|please (quote|price|provide (a )?(quote|price|pricing))|pricing (please|request)|can you (quote|price)|submit (pricing|a (quote|tender|price))|could i get a quote|quote for|tender(s)? clos(e|es|ing))\b/i;

export function sortMessage(msg: IncomingMessage): SortResult {
  const subject = msg.subject;
  const text = `${subject}\n${msg.bodyText}`;

  // A tender portal's sign-in code (quoteout asked for it to fetch documents): never a new RFQ.
  if (isPortalCodeEmail(msg.from, subject, msg.bodyText)) return { category: "junk", confident: true, reason: "Portal sign-in code." };
  // Order matters: an award email often mentions the tender it was for.
  if (has(text, AWARD)) return { category: "award", confident: true, reason: "Award or purchase-order wording." };
  if (has(text, INVOICE)) return { category: "invoice", confident: true, reason: "Invoice wording." };
  if (has(text, JUNK) && !has(subject, RFQ)) return { category: "junk", confident: true, reason: "Newsletter or marketing wording." };
  if (has(text, RFQ)) return { category: "rfq", confident: true, reason: "Request-for-quote wording." };
  return { category: "general", confident: false, reason: "No clear wording; AI to sort." };
}

/** Strip RE:/FW:/FWD: prefixes and extra spaces so replies and forwards compare equal. */
export function normaliseSubject(subject: string): string {
  let s = subject.trim();
  while (/^(re|fw|fwd)\s*:\s*/i.test(s)) s = s.replace(/^(re|fw|fwd)\s*:\s*/i, "");
  return s.replace(/\s+/g, " ").toLowerCase();
}

/**
 * Signature logos and similar: small inline images. A picture pasted into the body is kept when
 * the words just before it point at it ("Areas =", "quantities below:", "see table"), however small:
 * that's where builders paste the areas. Bigger inline pictures are always kept.
 */
export function isSignatureImage(a: IncomingAttachment, body = ""): boolean {
  if (!a.isInline || !a.contentType.startsWith("image/") || a.size >= 20_000) return false;
  return !pointedAt(a.name, body);
}

/** True when the text just before "[cid:NAME@" (or "[NAME]") introduces it as content. */
export function pointedAt(name: string, body: string): boolean {
  if (!name || !body) return false;
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = new RegExp(`\\[(?:cid:)?${esc}[@\\]]`, "i").exec(body);
  if (!m) return false;
  const before = body.slice(Math.max(0, m.index - 120), m.index).replace(/\s+/g, " ").trim().toLowerCase();
  return /[=:]$/.test(before) || /\b(areas?|quantit(y|ies)|schedule|table|takeoff|take-off|m2|m²|tonnes?|depths?|below|as follows|see (the )?(image|picture|attached))\b[^.]{0,40}$/.test(before);
}

/** Second duplicate key: sender + subject + attachment hashes (or the start of the body if none). */
export function contentHash(msg: IncomingMessage): string {
  const files = msg.attachments
    .filter((a) => !isSignatureImage(a))
    .map((a) => a.sha256 ?? `${a.name}:${a.size}`)
    .sort();
  const basis = [
    msg.from.trim().toLowerCase(),
    normaliseSubject(msg.subject),
    files.length ? files.join("|") : msg.bodyText.replace(/\s+/g, " ").trim().slice(0, 500).toLowerCase(),
  ].join("\n");
  return createHash("sha256").update(basis).digest("hex");
}

export type KnownMail = {
  /** Provider message ids already processed for this connection. */
  seenMessageIds: Set<string>;
  /** conversationId -> job id */
  jobByConversation: Map<string, string>;
  /** content hash -> job id (recent jobs only) */
  jobByContentHash: Map<string, string>;
};

export type LinkDecision =
  | { action: "already_seen" }
  | { action: "no_job" }
  | { action: "attach_to_job"; jobId: string; reason: string }
  | { action: "duplicate"; jobId: string; reason: string }
  | { action: "new_job" };

/** Decide what to do with a message. Safe to run twice: seen messages do nothing. */
export function decideLink(msg: IncomingMessage, category: Category, known: KnownMail): LinkDecision {
  if (known.seenMessageIds.has(msg.id)) return { action: "already_seen" };

  const threadJob = known.jobByConversation.get(msg.conversationId);
  if (threadJob) {
    return { action: "attach_to_job", jobId: threadJob, reason: "Reply on a thread that already has a job (revision or clarification)." };
  }
  if (category !== "rfq") return { action: "no_job" };

  const dupJob = known.jobByContentHash.get(contentHash(msg));
  if (dupJob) return { action: "duplicate", jobId: dupJob, reason: "Same sender, subject and attachments as an existing job." };

  return { action: "new_job" };
}

/** Links in an email that must never be followed automatically (declining a tender, changing bid status). */
export function isUnsafeLink(url: string): boolean {
  return /(decline|not[-_ ]?interested|withdraw|unsubscribe|opt[-_ ]?out|reject)/i.test(url);
}

/** Document/download links worth fetching (portal packs, file shares). */
export function documentLinks(text: string): string[] {
  const urls = text.match(/https?:\/\/[^\s<>"')]+/g) ?? [];
  return urls.filter((u) => !isUnsafeLink(u) && /(document|download|files?|share|drive|dropbox|wetransfer|box\.com|sharepoint|onedrive|tender)/i.test(u));
}

/** Pictures the email text points at as content ("Areas = [cid:image001.png@...]") that aren't among its files. */
export function missingPictures(text: string, fileNames: string[]): string[] {
  const have = new Set(fileNames.map((n) => n.toLowerCase()));
  const out: string[] = [];
  for (const m of text.matchAll(/\[cid:([^@\]\s]+)@/gi)) {
    const name = m[1];
    if (have.has(name.toLowerCase()) || out.includes(name)) continue;
    if (pointedAt(name, text)) out.push(name);
  }
  return out;
}
