import { NextResponse, type NextRequest } from "next/server";
import { requireTenant } from "@/lib/tenant";
import { createAdminClient } from "@/lib/supabase/admin";
import { encryptToken } from "@/lib/crypto/tokens";
import { XERO_SCOPES, xeroConfigFromEnv, xeroExchangeCode, xeroOrganisation } from "@/lib/xero";

/** Xero returns here after the admin approves access. */
export async function GET(request: NextRequest) {
  const origin = request.nextUrl.origin;
  const fail = (msg: string) => {
    const res = NextResponse.redirect(`${origin}/setup?error=${encodeURIComponent(msg)}`);
    res.cookies.delete({ name: "xero_oauth_state", path: "/api/connect/xero" });
    return res;
  };
  const ctx = await requireTenant();
  if (ctx.role !== "admin") return fail("Only a client admin can connect Xero.");
  const p = request.nextUrl.searchParams;
  if (p.get("error")) return fail(p.get("error_description") ?? "Xero sign-in was cancelled.");
  const [state, stateTenant] = (request.cookies.get("xero_oauth_state")?.value ?? "").split(".");
  if (!state || state !== p.get("state") || stateTenant !== ctx.tenant.id) return fail("That Xero sign-in expired. Please try connecting again.");
  const code = p.get("code");
  const cfg = xeroConfigFromEnv(origin);
  if (!code || !cfg) return fail("Xero isn't set up on the server yet.");

  try {
    const tokens = await xeroExchangeCode(cfg, code);
    const org = await xeroOrganisation(tokens.access_token);
    const db = createAdminClient();
    const tenantId = ctx.tenant.id;
    // One Xero connection per company: older ones are switched off.
    await db.from("connections").update({ status: "disconnected" }).eq("tenant_id", tenantId).eq("provider", "xero");
    const { data: conn, error } = await db.from("connections").insert({
      tenant_id: tenantId, provider: "xero", purpose: "accounting", account_email: org.name,
      scopes: [...XERO_SCOPES], status: "ok", last_ok_at: new Date().toISOString(),
    }).select("id").single();
    if (error || !conn) throw new Error(error?.message ?? "Could not save the connection.");
    const { error: secretErr } = await db.from("connection_secrets").insert({
      connection_id: conn.id, tenant_id: tenantId,
      token_ciphertext: encryptToken(tenantId, JSON.stringify({ ...tokens, xero_tenant_id: org.tenantId, org_name: org.name })),
      expires_at: new Date(tokens.expires_at).toISOString(),
    });
    if (secretErr) throw new Error(secretErr.message);
    await db.from("audit_log").insert({ tenant_id: tenantId, actor: ctx.userId, action: "connection.added", target: org.name, detail: { provider: "xero", purpose: "accounting", scopes: XERO_SCOPES } });
    const res = NextResponse.redirect(`${origin}/setup?connected=${encodeURIComponent(`Xero (${org.name})`)}`);
    res.cookies.delete({ name: "xero_oauth_state", path: "/api/connect/xero" });
    return res;
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Connecting Xero failed.");
  }
}
