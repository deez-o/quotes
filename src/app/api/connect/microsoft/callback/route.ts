import { NextResponse, type NextRequest } from "next/server";
import { requireTenant } from "@/lib/tenant";
import { createAdminClient } from "@/lib/supabase/admin";
import { exchangeCode, graphClientState, msConfigFromEnv, MS_SCOPES, whoAmI } from "@/lib/microsoft/oauth";
import { encryptToken } from "@/lib/crypto/tokens";
import { GraphMailbox } from "@/lib/mail/graph";

/** Microsoft returns here after the admin approves access. */
export async function GET(request: NextRequest) {
  const origin = request.nextUrl.origin;
  const fail = (msg: string) => {
    const res = NextResponse.redirect(`${origin}/setup?error=${encodeURIComponent(msg)}`);
    res.cookies.delete({ name: "ms_oauth_state", path: "/api/connect/microsoft" });
    return res;
  };

  const ctx = await requireTenant();
  if (ctx.role !== "admin") return fail("Only a client admin can connect the inbox.");

  const params = request.nextUrl.searchParams;
  if (params.get("error")) return fail(params.get("error_description") ?? "Microsoft sign-in was cancelled.");

  const [state, stateTenant] = (request.cookies.get("ms_oauth_state")?.value ?? "").split(".");
  if (!state || state !== params.get("state") || stateTenant !== ctx.tenant.id) {
    return fail("That sign-in link expired. Please try connecting again.");
  }

  const code = params.get("code");
  const cfg = msConfigFromEnv(origin);
  const clientState = graphClientState();
  if (!code || !cfg || !clientState) return fail("Microsoft connection isn't set up on the server yet.");

  try {
    const tokens = await exchangeCode(cfg, code);
    const me = await whoAmI(tokens.access_token);
    const db = createAdminClient();
    const tenantId = ctx.tenant.id;

    // Reconnecting (e.g. to allow a new permission): replace the old connection, its tokens and inbox watch.
    await db.from("connections").delete().eq("tenant_id", tenantId).eq("provider", "microsoft").eq("purpose", "mailbox");
    const { data: conn, error: connErr } = await db.from("connections").insert({
      tenant_id: tenantId, provider: "microsoft", purpose: "mailbox", account_email: me.email,
      scopes: [...MS_SCOPES], status: "ok", last_ok_at: new Date().toISOString(),
    }).select("id").single();
    if (connErr || !conn) throw new Error(connErr?.message ?? "Could not save the connection.");

    const { error: secretErr } = await db.from("connection_secrets").insert({
      connection_id: conn.id, tenant_id: tenantId,
      token_ciphertext: encryptToken(tenantId, JSON.stringify(tokens)),
      expires_at: new Date(tokens.expires_at).toISOString(),
    });
    if (secretErr) throw new Error(secretErr.message);

    // Push notifications for new mail. Message subscriptions last under 7 days; the worker renews daily.
    const mailbox = new GraphMailbox(async () => tokens.access_token);
    const expires = new Date(Date.now() + 2 * 24 * 3600 * 1000);
    const sub = await mailbox.createInboxSubscription(`${origin}/api/webhooks/graph`, clientState, expires);
    await db.from("mail_watches").insert({
      tenant_id: tenantId, connection_id: conn.id, subscription_id: sub.id, expires_at: sub.expirationDateTime,
    });

    await db.from("audit_log").insert({
      tenant_id: tenantId, actor: ctx.userId, action: "connection.added", target: me.email,
      detail: { provider: "microsoft", purpose: "mailbox", scopes: MS_SCOPES },
    });

    const res = NextResponse.redirect(`${origin}/setup?connected=${encodeURIComponent(me.email)}`);
    res.cookies.delete({ name: "ms_oauth_state", path: "/api/connect/microsoft" });
    return res;
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Connecting Microsoft failed.");
  }
}
