/**
 * Emails forwarded to <customer>@<INBOUND_DOMAIN>. The inbound email service
 * (e.g. Cloudflare Email Routing with a small worker, or any provider that can
 * POST the raw message) sends the raw email here. Kept free of Next.js and
 * Supabase so it can be tested with fakes.
 */
import PostalMime from "postal-mime";

export const MAX_INBOUND_BYTES = 30 * 1024 * 1024;

export type InboundDeps = {
  domain: string;
  tenantForLocalPart: (localPart: string) => Promise<string | null>;
  isTeamMember: (tenantId: string, email: string) => Promise<boolean>;
  store: (tenantId: string, inboundId: string, raw: Uint8Array) => Promise<string>; // returns storage path
  enqueue: (tenantId: string, inboundId: string, path: string) => Promise<void>;
  newId: () => string;
};

export type InboundResult =
  | { status: "queued"; tenantId: string; inboundId: string }
  | { status: "ignored"; reason: string };

/** Recipient local part on our domain: prefer the envelope recipient, then the headers. */
export function recipientLocalPart(domain: string, envelopeTo: string | null, headerTo: string[]): string | null {
  const candidates = [envelopeTo ?? "", ...headerTo].map((a) => a.trim().toLowerCase());
  const suffix = `@${domain.toLowerCase()}`;
  for (const a of candidates) {
    const addr = /<([^>]+)>/.exec(a)?.[1] ?? a;
    if (addr.endsWith(suffix)) return addr.slice(0, -suffix.length).split("+")[0];
  }
  return null;
}

export async function handleInbound(raw: Uint8Array, envelopeTo: string | null, deps: InboundDeps): Promise<InboundResult> {
  if (raw.byteLength === 0) return { status: "ignored", reason: "empty" };
  if (raw.byteLength > MAX_INBOUND_BYTES) return { status: "ignored", reason: "too large" };

  const email = await PostalMime.parse(raw);
  const headerTo = [...(email.to ?? []), ...(email.cc ?? [])].map((t) => ("address" in t ? t.address ?? "" : ""));
  const delivered = email.deliveredTo ? [email.deliveredTo] : [];
  const local = recipientLocalPart(deps.domain, envelopeTo, [...delivered, ...headerTo]);
  if (!local) return { status: "ignored", reason: "not addressed to a Quotr address" };

  const tenantId = await deps.tenantForLocalPart(local);
  if (!tenantId) return { status: "ignored", reason: "unknown address" };

  const sender = email.from && "address" in email.from ? email.from.address ?? "" : "";
  // Only the customer's own people can send RFQs in, so a spammer who learns the address gets nowhere.
  if (!sender || !(await deps.isTeamMember(tenantId, sender))) {
    return { status: "ignored", reason: "sender is not on the team" };
  }

  const inboundId = deps.newId();
  const path = await deps.store(tenantId, inboundId, raw);
  await deps.enqueue(tenantId, inboundId, path);
  return { status: "queued", tenantId, inboundId };
}
