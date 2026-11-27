/**
 * Turns emails that arrive WITHOUT an inbox connection into the standard
 * IncomingMessage the engine uses:
 *  - a saved email file dragged into the portal (.eml from most apps, .msg from Outlook)
 *  - loose files plus pasted email text
 *  - an email forwarded to the customer's Quotr address (the original RFQ is
 *    either attached as an email file, or quoted in the body)
 */
import { createHash } from "node:crypto";
import PostalMime from "postal-mime";
import MsgReader from "@kenjiuno/msgreader";
import { normaliseSubject } from "./sort";
import type { IncomingAttachment, IncomingMessage } from "./types";

export type ParsedEmail = { message: IncomingMessage; files: Map<string, Uint8Array> };
export type LooseFile = { name: string; type: string; bytes: Uint8Array };

const toBytes = (c: ArrayBuffer | Uint8Array | string): Uint8Array =>
  typeof c === "string" ? new TextEncoder().encode(c) : c instanceof Uint8Array ? c : new Uint8Array(c);

const shortHash = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 16);

export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h\d)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Thread key for emails that don't come from a connected inbox: the same
 * sender and subject (ignoring RE:/FW:) belong to the same job.
 */
export function threadKey(from: string, subject: string): string {
  return `t:${shortHash(`${from.trim().toLowerCase()}|${normaliseSubject(subject)}`)}`;
}

export function isEmailFile(name: string, type: string): boolean {
  return /\.(eml|msg)$/i.test(name) || type === "message/rfc822" || type === "application/vnd.ms-outlook";
}

/** A saved .eml file (Gmail, Apple Mail, Thunderbird, Outlook web "download"). */
export async function parseEml(bytes: Uint8Array, idPrefix: string): Promise<ParsedEmail> {
  const email = await PostalMime.parse(bytes);
  const files = new Map<string, Uint8Array>();
  const attachments: IncomingAttachment[] = email.attachments.map((a, i) => {
    const id = `${idPrefix}-a${i + 1}`;
    const content = toBytes(a.content);
    files.set(id, content);
    return {
      id,
      name: a.filename ?? `attachment-${i + 1}`,
      contentType: a.mimeType || "application/octet-stream",
      size: content.byteLength,
      isInline: a.disposition === "inline" || Boolean(a.contentId && a.disposition !== "attachment"),
    };
  });

  const from = email.from && "address" in email.from ? email.from.address ?? "" : "";
  const subject = email.subject ?? "";
  return {
    message: {
      id: `${idPrefix}:${email.messageId ?? shortHash(`${from}${subject}${email.date ?? ""}`)}`,
      conversationId: threadKey(from, subject),
      from,
      to: (email.to ?? []).map((t) => ("address" in t ? t.address : "")).filter(Boolean).join(", "),
      subject,
      receivedAt: email.date ? new Date(email.date).toISOString() : new Date().toISOString(),
      bodyText: email.text?.trim() || htmlToText(email.html ?? ""),
      attachments,
    },
    files,
  };
}

/** A saved Outlook .msg file (dragging an email out of desktop Outlook). */
export function parseMsg(bytes: Uint8Array, idPrefix: string): ParsedEmail {
  const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const reader = new MsgReader(ab);
  const data = reader.getFileData();
  if (data.error) throw new Error(`Could not read the Outlook email: ${data.error}`);

  const files = new Map<string, Uint8Array>();
  const attachments: IncomingAttachment[] = (data.attachments ?? []).map((a, i) => {
    const id = `${idPrefix}-a${i + 1}`;
    const att = reader.getAttachment(a);
    files.set(id, att.content);
    return {
      id,
      name: att.fileName || a.fileName || `attachment-${i + 1}`,
      contentType: a.attachMimeTag ?? "application/octet-stream",
      size: att.content.byteLength,
      isInline: Boolean(a.attachmentHidden || a.pidContentId),
    };
  });

  const from = data.senderSmtpAddress ?? data.senderEmail ?? "";
  const subject = data.subject ?? "";
  const when = data.messageDeliveryTime ?? data.clientSubmitTime ?? data.creationTime;
  return {
    message: {
      id: `${idPrefix}:${shortHash(`${from}${subject}${when ?? ""}`)}`,
      conversationId: threadKey(from, subject),
      from,
      to: (data.recipients ?? []).map((r) => r.smtpAddress ?? r.email ?? "").filter(Boolean).join(", "),
      subject,
      receivedAt: when ? new Date(when).toISOString() : new Date().toISOString(),
      bodyText: data.body?.trim() || htmlToText(data.bodyHtml ?? ""),
      attachments,
    },
    files,
  };
}

export async function parseEmailFile(file: LooseFile, idPrefix: string): Promise<ParsedEmail> {
  return /\.msg$/i.test(file.name) || file.type === "application/vnd.ms-outlook"
    ? parseMsg(file.bytes, idPrefix)
    : parseEml(file.bytes, idPrefix);
}

/** Original sender and subject from a forwarded email's quoted header block. */
export function unquoteForward(body: string): { from: string | null; subject: string | null; sent: string | null; body: string } {
  const lines = body.replace(/\r/g, "").split("\n");
  const start = lines.findIndex((l) =>
    /^-{2,}\s*(forwarded message|original message)\s*-{2,}$/i.test(l.trim()) || /^begin forwarded message:?$/i.test(l.trim()) || /^from:\s*\S/i.test(l.trim()),
  );
  if (start === -1) return { from: null, subject: null, sent: null, body };

  let from: string | null = null;
  let subject: string | null = null;
  let sent: string | null = null;
  let i = start;
  if (!/^from:/i.test(lines[i].trim())) i++;
  for (; i < lines.length && i < start + 12; i++) {
    const l = lines[i].trim();
    if (l === "") {
      if (from || subject) break;
      continue;
    }
    const m = /^(from|sent|date|to|cc|subject):\s*(.*)$/i.exec(l);
    if (!m) break;
    const key = m[1].toLowerCase();
    if (key === "from") from = (/<([^>]+@[^>]+)>/.exec(m[2])?.[1] ?? /\S+@\S+/.exec(m[2])?.[0] ?? m[2]).trim();
    if (key === "subject") subject = m[2].trim();
    if (key === "sent" || key === "date") sent = m[2].trim();
  }
  return { from, subject, sent, body: lines.slice(i).join("\n").trim() };
}

/**
 * Loose files and/or pasted text (no email file). Uses a pasted forward header
 * if there is one, else the first line as the subject.
 */
export function fromLooseFiles(input: { files: LooseFile[]; pastedText: string; uploader: string; idPrefix: string }): ParsedEmail {
  const files = new Map<string, Uint8Array>();
  const attachments: IncomingAttachment[] = input.files.map((f, i) => {
    const id = `${input.idPrefix}-a${i + 1}`;
    files.set(id, f.bytes);
    return { id, name: f.name, contentType: f.type || "application/octet-stream", size: f.bytes.byteLength, isInline: false };
  });

  const text = input.pastedText.trim();
  const q = unquoteForward(text);
  const firstLine = text.split("\n").find((l) => l.trim())?.trim() ?? "";
  const subject = q.subject ?? (firstLine.slice(0, 120) || `Uploaded RFQ: ${input.files[0]?.name ?? "no files"}`);
  const from = q.from ?? input.uploader;

  return {
    message: {
      id: `${input.idPrefix}:loose`,
      conversationId: threadKey(from, subject),
      from,
      to: "",
      subject,
      receivedAt: new Date().toISOString(),
      bodyText: q.from || q.subject ? q.body : text,
      attachments,
    },
    files,
  };
}

/**
 * An email forwarded to the customer's Quotr address. If the original RFQ is
 * attached as an email file, that becomes the message (its files included);
 * otherwise the quoted header in the body gives the original sender and subject.
 */
export async function unwrapForwarded(outer: ParsedEmail, idPrefix: string): Promise<ParsedEmail & { forwardedBy: string; note: string }> {
  const forwardedBy = outer.message.from;
  const inner = outer.message.attachments.find((a) => isEmailFile(a.name, a.contentType));
  if (inner) {
    const parsed = await parseEmailFile(
      { name: inner.name, type: inner.contentType, bytes: outer.files.get(inner.id)! },
      `${idPrefix}-fw`, // distinct ids from the outer email's attachments
    );
    // Any other files the estimator attached alongside the email come too.
    for (const a of outer.message.attachments) {
      if (a.id === inner.id) continue;
      parsed.message.attachments.push(a);
      parsed.files.set(a.id, outer.files.get(a.id)!);
    }
    const note = outer.message.bodyText.split(/\n-{2,}|\nFrom:/i)[0].trim();
    return { ...parsed, forwardedBy, note };
  }

  const q = unquoteForward(outer.message.bodyText);
  const originalSubject = q.subject ?? outer.message.subject.replace(/^\s*(fw|fwd)\s*:\s*/i, "");
  const originalFrom = q.from ?? forwardedBy;
  const note = q.from ? outer.message.bodyText.split(/\n-{2,}|\nFrom:/i)[0].trim() : "";
  return {
    message: {
      ...outer.message,
      from: originalFrom,
      subject: originalSubject,
      conversationId: threadKey(originalFrom, originalSubject),
      bodyText: q.from ? q.body : outer.message.bodyText,
    },
    files: outer.files,
    forwardedBy,
    note,
  };
}
