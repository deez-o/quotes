/** Shared by the worker and the quote page. */
export type RfqSummary = {
  from: string; subject: string; received: string | null;
  files: { name: string; path: string; read: "text" | "image" | "no"; note: string | null }[];
  followUps: number;
  /** Set when the RFQ was forwarded: who forwarded it (summary.from is the original sender). */
  forwardedBy?: string | null;
  original?: OriginalSender | null;
  /** The AI model that drafted it. */
  model?: string | null;
};

/** Splits our saved "From/To/Date/Subject + body" text back into header and body. */
export function splitSavedEmail(text: string) {
  const [head, ...rest] = text.split(/\r?\n\r?\n/);
  const get = (k: string) => new RegExp(`^${k}: (.*)$`, "mi").exec(head)?.[1]?.trim() ?? null;
  return { from: get("From"), subject: get("Subject"), date: get("Date"), body: rest.join("\n\n") };
}

export type OriginalSender = { name: string | null; email: string | null; subject: string | null; date: string | null };

/**
 * A forwarded email: who really sent it. Reads the first forwarded header block
 * ("From: / Sent: / Subject:" from Outlook, "---------- Forwarded message" from Gmail).
 * Null if the email wasn't forwarded.
 */
export function forwardedFrom(body: string): OriginalSender | null {
  const text = body.replace(/\r/g, "");
  // A header block: a From: line followed within a few lines by Sent:/Date: and Subject:.
  const re = /^[ \t>*]*From:[ \t*]*(.+)\n((?:[ \t>*]*[A-Za-z-]+:.*\n){1,6})/m;
  const m = re.exec(text);
  if (!m) return null;
  const block = m[2];
  const field = (k: string) => new RegExp(`^[ \\t>*]*${k}:[ \\t*]*(.*)$`, "mi").exec(block)?.[1]?.trim() || null;
  const date = field("Sent") ?? field("Date");
  const subject = field("Subject");
  if (!date && !subject) return null; // a plain "From:" line in the body, not a forward
  const from = m[1].replace(/\*/g, "").trim();
  const email = /[\w.+'-]+@[\w-]+(?:\.[\w-]+)+/.exec(from)?.[0]?.toLowerCase() ?? null;
  let name = from.replace(/<[^>]*>|\[mailto:[^\]]*\]|\(mailto:[^)]*\)/gi, "").replace(email ?? "\u0000", "").replace(/["']/g, "").trim();
  if (!name || name.includes("@")) name = "";
  return { name: name || null, email, subject, date };
}

/** "FW: RE: RFQ - Carpark" -> "RFQ - Carpark". */
export function cleanSubject(s: string): string {
  return s.replace(/^\s*(?:(?:re|fw|fwd|aw|wg)\s*:\s*|\[spam\]\s*)+/gi, "").trim();
}
