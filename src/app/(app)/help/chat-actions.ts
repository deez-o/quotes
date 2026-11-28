"use server";

import { requireTenant } from "@/lib/tenant";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { keyFor, liveModel, structuredCall } from "@/lib/ai/call";
import { recordAi } from "@/lib/usage";
import { HELP_SCHEMA, helpSystemPrompt } from "@/lib/help/guide";
import { sendEmail } from "@/lib/mail/send";
import { appUrl } from "@/lib/app-url";
import type { ChatMessage } from "@/lib/quote/provider";

export type ChatMsg = { role: "user" | "assistant"; text: string; at: string; person?: boolean };
type Out = { ok: true; chatId: string; messages: ChatMsg[] } | { ok: false; message: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PER_DAY = 60;
const ROLE = { admin: "client admin", estimator: "estimator", viewer: "viewer" } as const;

/** Ask the help assistant. Each person's conversation is kept (quoteout staff can read them). */
export async function askHelp(input: { chatId: string | null; text: string; page: string | null }): Promise<Out> {
  const ctx = await requireTenant();
  const text = String(input.text ?? "").trim().slice(0, 2000);
  if (text.length < 2) return { ok: false, message: "Type your question." };
  const admin = createAdminClient();

  const since = new Date(Date.now() - 86400_000).toISOString();
  const { count } = await admin.from("usage_events").select("id", { count: "exact", head: true }).eq("tenant_id", ctx.tenant.id).eq("user_id", ctx.userId).eq("kind", "ai_help").gte("created_at", since);
  if ((count ?? 0) >= PER_DAY) return { ok: false, message: "That's a lot of questions today. Use Ask us below and the team will help." };

  let chat: { id: string; messages: ChatMsg[] } | null = null;
  if (input.chatId && UUID.test(input.chatId)) {
    const { data } = await admin.from("help_chats").select("id, messages").eq("id", input.chatId).eq("tenant_id", ctx.tenant.id).eq("user_id", ctx.userId).maybeSingle();
    if (data) chat = { id: data.id as string, messages: (data.messages as ChatMsg[]) ?? [] };
  }
  const now = new Date().toISOString();
  const history = [...(chat?.messages ?? []), { role: "user" as const, text, at: now }];

  const model = await liveModel();
  if (!keyFor(model)) return { ok: false, message: "The assistant isn't switched on yet. Use Ask us below." };
  const messages: ChatMessage[] = [
    { role: "system", content: helpSystemPrompt(ctx.tenant.name, ROLE[ctx.role], input.page ? String(input.page).slice(0, 200) : null) },
    ...history.slice(-16).map((m) => ({ role: m.role, content: m.text }) as ChatMessage),
  ];
  let reply = "Sorry, I couldn't answer just now. Try again, or use Ask us below.";
  let person = false;
  try {
    const r = await structuredCall(model, HELP_SCHEMA, messages);
    await recordAi(ctx.tenant.id, ctx.userId, "ai_help", r);
    const j = r.json as { reply?: unknown; needs_person?: unknown };
    if (typeof j?.reply === "string" && j.reply.trim()) reply = j.reply.trim().slice(0, 4000);
    person = j?.needs_person === true;
  } catch {
    person = true;
  }
  const all = [...history, { role: "assistant" as const, text: reply, at: new Date().toISOString(), person }].slice(-100);

  if (chat) {
    await admin.from("help_chats").update({ messages: all, updated_at: new Date().toISOString() }).eq("id", chat.id).eq("tenant_id", ctx.tenant.id);
    return { ok: true, chatId: chat.id, messages: all };
  }
  const { data: made, error } = await admin.from("help_chats").insert({ tenant_id: ctx.tenant.id, user_id: ctx.userId, email: ctx.email, messages: all, page: input.page ? String(input.page).slice(0, 200) : null }).select("id").single();
  if (error) return { ok: false, message: "Couldn't save the conversation." };
  return { ok: true, chatId: made.id as string, messages: all };
}

/** Send the conversation to the quoteout team as a help request. */
export async function sendChatToTeam(input: { chatId: string; note?: string }): Promise<{ ok: boolean; message: string }> {
  const ctx = await requireTenant();
  if (!UUID.test(input.chatId)) return { ok: false, message: "Conversation not found." };
  const admin = createAdminClient();
  const { data: chat } = await admin.from("help_chats").select("id, messages, escalated, page").eq("id", input.chatId).eq("tenant_id", ctx.tenant.id).eq("user_id", ctx.userId).maybeSingle();
  if (!chat) return { ok: false, message: "Conversation not found." };
  if (chat.escalated) return { ok: true, message: "Already sent to the team. They'll reply by email." };
  const transcript = ((chat.messages as ChatMsg[]) ?? []).map((m) => `${m.role === "user" ? "Them" : "Assistant"}: ${m.text}`).join("\n\n").slice(0, 20000);
  const note = String(input.note ?? "").trim().slice(0, 2000);
  await admin.from("support_requests").insert({ tenant_id: ctx.tenant.id, user_id: ctx.userId, email: ctx.email, topic: "From the help assistant", message: `${note ? `${note}\n\n---\n` : ""}${transcript}`, page: chat.page });
  await admin.from("help_chats").update({ escalated: true }).eq("id", chat.id);
  const to = (process.env.SUPPORT_EMAIL || process.env.ALERT_EMAIL || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (to.length) {
    const body = `From: ${ctx.email ?? "-"} (${ctx.tenant.name})\n${note ? `\n${note}\n` : ""}\n${transcript}\n\n${appUrl()}/admin/help-chats`;
    await sendEmail({ fromName: "quoteout help", replyTo: ctx.email, to, cc: [], subject: `[Help chat] ${ctx.tenant.name}`, text: body, html: `<pre style="font-family:Arial,sans-serif;white-space:pre-wrap">${body.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</pre>`, attachments: [] }).catch(() => null);
  }
  return { ok: true, message: `Sent to the quoteout team. They'll reply to ${ctx.email ?? "you"} by email.` };
}

/** The person's latest conversation, to carry on where they left off. */
export async function latestChat(): Promise<{ chatId: string; messages: ChatMsg[] } | null> {
  const ctx = await requireTenant();
  const db = await createClient();
  const { data } = await db.from("help_chats").select("id, messages, updated_at").eq("tenant_id", ctx.tenant.id).eq("user_id", ctx.userId).order("updated_at", { ascending: false }).limit(1).maybeSingle();
  if (!data || Date.now() - new Date(data.updated_at as string).getTime() > 3 * 86400_000) return null;
  return { chatId: data.id as string, messages: (data.messages as ChatMsg[]) ?? [] };
}
