import { randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { requireTenant } from "@/lib/tenant";
import { authorizeUrl, msConfigFromEnv } from "@/lib/microsoft/oauth";

/** Start "Connect Microsoft 365": client admins only. */
export async function GET(request: NextRequest) {
  const ctx = await requireTenant();
  const origin = request.nextUrl.origin;
  if (ctx.role !== "admin") return NextResponse.redirect(`${origin}/setup?error=${encodeURIComponent("Only a client admin can connect the inbox.")}`);

  const cfg = msConfigFromEnv(origin);
  if (!cfg) return NextResponse.redirect(`${origin}/setup?error=${encodeURIComponent("Microsoft connection isn't set up on the server yet.")}`);

  // CSRF protection: random state, kept in a short-lived httpOnly cookie, checked on return.
  const state = randomBytes(24).toString("base64url");
  const res = NextResponse.redirect(authorizeUrl(cfg, state));
  res.cookies.set("ms_oauth_state", `${state}.${ctx.tenant.id}`, {
    httpOnly: true, secure: true, sameSite: "lax", path: "/api/connect/microsoft", maxAge: 600,
  });
  return res;
}
