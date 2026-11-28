"use server";

import { revalidatePath } from "next/cache";
import { requireTenant } from "@/lib/tenant";
import { createAdminClient } from "@/lib/supabase/admin";
import { PORTAL_PROVIDERS, savePortalLogin, type PortalProvider } from "@/lib/portal/logins";

type R = { ok: true; message: string } | { ok: false; message: string };

export async function savePortal(input: { provider: string; username: string; password: string }): Promise<R> {
  const ctx = await requireTenant();
  if (ctx.role !== "admin") return { ok: false, message: "Only a client admin can add portal logins." };
  const p = PORTAL_PROVIDERS.find((x) => x.provider === input.provider);
  if (!p) return { ok: false, message: "Pick a portal." };
  const username = String(input.username ?? "").trim().slice(0, 200);
  const password = String(input.password ?? "").slice(0, 200);
  if (!username || !password) return { ok: false, message: "Enter the email and password you sign in to the portal with." };
  const db = createAdminClient();
  await savePortalLogin(db, ctx.tenant.id, p.provider as PortalProvider, username, password);
  await db.from("audit_log").insert({ tenant_id: ctx.tenant.id, actor: ctx.userId, action: "connection.added", target: username, detail: { provider: p.provider, purpose: "portal" } });
  revalidatePath("/setup");
  return { ok: true, message: `Saved your ${p.name} login. Documents for new ${p.name} invites will be fetched automatically.` };
}

export async function removePortal(input: { provider: string }): Promise<R> {
  const ctx = await requireTenant();
  if (ctx.role !== "admin") return { ok: false, message: "Only a client admin can remove portal logins." };
  const db = createAdminClient();
  await db.from("connections").delete().eq("tenant_id", ctx.tenant.id).eq("provider", input.provider).eq("purpose", "portal");
  await db.from("audit_log").insert({ tenant_id: ctx.tenant.id, actor: ctx.userId, action: "connection.removed", target: input.provider, detail: { purpose: "portal" } });
  revalidatePath("/setup");
  return { ok: true, message: "Removed." };
}
