import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { decryptToken, encryptToken } from "@/lib/crypto/tokens";
import { xeroClient, xeroConfigFromEnv, xeroValidToken, type XeroCall, type XeroTokens } from "@/lib/xero";
import { appUrl } from "@/lib/app-url";
import { statusFromXero } from "@/lib/xero-status";
export { statusFromXero };

/** A signed-in Xero caller for one company (refreshing its token as needed), or why there isn't one. */
export async function xeroForTenant(admin: SupabaseClient, tenantId: string, origin = appUrl()): Promise<{ ok: true; call: XeroCall; connectionId: string } | { ok: false; message: string }> {
  const cfg = xeroConfigFromEnv(origin.startsWith("https://") ? origin : "https://localhost");
  if (!cfg) return { ok: false, message: "Xero isn't set up on the server yet." };
  const { data: conn } = await admin.from("connections").select("id").eq("tenant_id", tenantId).eq("provider", "xero").eq("status", "ok")
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (!conn) return { ok: false, message: "Connect Xero first (Setup)." };
  const { data: secret } = await admin.from("connection_secrets").select("token_ciphertext").eq("connection_id", conn.id).eq("tenant_id", tenantId).maybeSingle();
  if (!secret) return { ok: false, message: "Reconnect Xero (Setup)." };
  let tokens = JSON.parse(decryptToken(tenantId, secret.token_ciphertext)) as XeroTokens;
  try {
    tokens = await xeroValidToken(cfg, tokens, async (fresh) => {
      await admin.from("connection_secrets").update({ token_ciphertext: encryptToken(tenantId, JSON.stringify(fresh)), expires_at: new Date(fresh.expires_at).toISOString(), updated_at: new Date().toISOString() })
        .eq("connection_id", conn.id).eq("tenant_id", tenantId);
    });
  } catch {
    await admin.from("connections").update({ status: "error", last_error: "Xero sign-in expired" }).eq("id", conn.id);
    return { ok: false, message: "Xero needs reconnecting (Setup): the sign-in has expired." };
  }
  if (!tokens.xero_tenant_id) return { ok: false, message: "Reconnect Xero (Setup)." };
  return { ok: true, call: xeroClient(tokens.access_token, tokens.xero_tenant_id), connectionId: conn.id as string };
}

/**
 * Quotes sent to Xero that the customer has since accepted or declined there: mark them
 * won or lost here. Checks at most `limit` quotes (Xero allows 60 calls a minute).
 */
export async function syncXeroQuotes(admin: SupabaseClient, tenantId: string, opts: { ids?: string[]; limit?: number } = {}): Promise<number> {
  let q = admin.from("site_quotes").select("id, xero_quote_id, status, option_group").eq("tenant_id", tenantId).not("xero_quote_id", "is", null)
    .in("status", ["draft", "sent"]).is("superseded_at", null).order("xero_sent_at", { ascending: false }).limit(opts.limit ?? 40);
  if (opts.ids?.length) q = q.in("id", opts.ids);
  const { data: rows } = await q;
  if (!rows?.length) return 0;
  const x = await xeroForTenant(admin, tenantId);
  if (!x.ok) return 0;
  let changed = 0;
  for (const r of rows) {
    try {
      const out = (await x.call(`/Quotes/${encodeURIComponent(r.xero_quote_id as string)}`)) as { Quotes?: { Status?: string }[] };
      const status = statusFromXero(out.Quotes?.[0]?.Status);
      if (!status) continue;
      const now = new Date().toISOString();
      await admin.from("site_quotes").update(status === "won"
        ? { status, accepted_at: now, accepted_name: "Accepted in Xero" }
        : { status }).eq("tenant_id", tenantId).eq("id", r.id).in("status", ["draft", "sent"]);
      if (status === "won" && r.option_group) await admin.from("site_quotes").update({ status: "lost" }).eq("tenant_id", tenantId).eq("option_group", r.option_group).neq("id", r.id).in("status", ["draft", "sent"]);
      await admin.from("audit_log").insert({ tenant_id: tenantId, actor: null, action: `quote.${status}_in_xero`, target: r.id });
      changed++;
    } catch {
      // Skip this one; try again next time.
    }
  }
  return changed;
}
