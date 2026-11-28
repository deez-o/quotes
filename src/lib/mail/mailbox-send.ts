import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { planFor } from "@/lib/plans";
import { graphForConnection } from "@/lib/worker/handlers";
import { decryptToken } from "@/lib/crypto/tokens";
import type { MsTokens } from "@/lib/microsoft/oauth";
import { appUrl } from "@/lib/app-url";

export type MailboxSender = { connectionId: string; email: string };

/**
 * The company's own connected Outlook mailbox to send quotes from, when they've chosen that
 * (Business plan, connection healthy, and the sign-in allowed sending). Null means send through quoteout.
 */
export async function mailboxSender(admin: SupabaseClient, tenantId: string): Promise<MailboxSender | null> {
  const [{ data: t }, { data: s }] = await Promise.all([
    admin.from("tenants").select("plan").eq("id", tenantId).single(),
    admin.from("tenant_settings").select("send_from_mailbox").eq("tenant_id", tenantId).maybeSingle(),
  ]);
  if (!s?.send_from_mailbox || !planFor(t?.plan as string | null).connectedMailbox) return null;
  const c = await sendableMailbox(admin, tenantId);
  return c?.canSend ? { connectionId: c.connectionId, email: c.email } : null;
}

/** The connected Outlook mailbox, and whether its sign-in includes permission to send. */
export async function sendableMailbox(admin: SupabaseClient, tenantId: string): Promise<{ connectionId: string; email: string; canSend: boolean } | null> {
  const { data: conn } = await admin.from("connections").select("id, account_email").eq("tenant_id", tenantId).eq("provider", "microsoft").eq("purpose", "mailbox").eq("status", "ok")
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (!conn?.account_email) return null;
  const { data: sec } = await admin.from("connection_secrets").select("token_ciphertext").eq("tenant_id", tenantId).eq("connection_id", conn.id).maybeSingle();
  let canSend = false;
  try {
    const tokens = sec ? (JSON.parse(decryptToken(tenantId, sec.token_ciphertext as string)) as MsTokens) : null;
    canSend = Boolean(tokens?.scope && /\bMail\.Send\b/i.test(tokens.scope));
  } catch { canSend = false; }
  return { connectionId: conn.id as string, email: conn.account_email as string, canSend };
}

/** Send through the company's own mailbox. Throws on failure so the caller can fall back. */
export async function sendFromMailbox(admin: SupabaseClient, tenantId: string, sender: MailboxSender, m: { to: string[]; cc: string[]; subject: string; html: string; attachments: { filename: string; content: Uint8Array }[] }) {
  const graph = await graphForConnection(admin, appUrl(), tenantId, sender.connectionId);
  await graph.sendMail({
    to: m.to, cc: m.cc, subject: m.subject, html: m.html,
    attachments: m.attachments.map((a) => ({ filename: a.filename, contentType: a.filename.endsWith(".pdf") ? "application/pdf" : "application/octet-stream", base64: Buffer.from(a.content).toString("base64") })),
  });
}
