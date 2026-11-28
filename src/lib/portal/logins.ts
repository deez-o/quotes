/**
 * Tender portal logins. The username and password are encrypted with the tenant's key and kept in
 * connection_secrets (service role only). Only the worker decrypts them, to fetch tender documents.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { decryptToken, encryptToken } from "@/lib/crypto/tokens";

import { PORTAL_PROVIDERS, providerFor, type PortalProvider } from "./providers";
export { PORTAL_PROVIDERS, providerFor, type PortalProvider };

export type PortalLogin = { connectionId: string; username: string; password: string };

export async function savePortalLogin(db: SupabaseClient, tenantId: string, provider: PortalProvider, username: string, password: string) {
  const { data: existing } = await db.from("connections").select("id").eq("tenant_id", tenantId).eq("provider", provider).eq("purpose", "portal").maybeSingle();
  let id = existing?.id as string | undefined;
  const now = new Date().toISOString();
  if (id) {
    await db.from("connections").update({ account_email: username, status: "ok", last_error: null, last_ok_at: null }).eq("id", id).eq("tenant_id", tenantId);
  } else {
    const { data, error } = await db.from("connections").insert({ tenant_id: tenantId, provider, purpose: "portal", account_email: username, status: "ok", scopes: [] }).select("id").single();
    if (error || !data) throw new Error(error?.message ?? "Couldn't save the login.");
    id = data.id as string;
  }
  const { error } = await db.from("connection_secrets").upsert({
    connection_id: id, tenant_id: tenantId, token_ciphertext: encryptToken(tenantId, JSON.stringify({ username, password })), updated_at: now,
  });
  if (error) throw new Error(error.message);
}

export async function loadPortalLogin(db: SupabaseClient, tenantId: string, provider: PortalProvider): Promise<PortalLogin | null> {
  const { data: c } = await db.from("connections").select("id, status").eq("tenant_id", tenantId).eq("provider", provider).eq("purpose", "portal").maybeSingle();
  if (!c) return null;
  const { data: s } = await db.from("connection_secrets").select("token_ciphertext").eq("connection_id", c.id).eq("tenant_id", tenantId).maybeSingle();
  if (!s) return null;
  const { username, password } = JSON.parse(decryptToken(tenantId, s.token_ciphertext as string)) as { username: string; password: string };
  return { connectionId: c.id as string, username, password };
}
