import { randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { requireTenant } from "@/lib/tenant";
import { xeroAuthorizeUrl, xeroConfigFromEnv } from "@/lib/xero";

/** Start "Connect Xero": client admins only. */
export async function GET(request: NextRequest) {
  const ctx = await requireTenant();
  const origin = request.nextUrl.origin;
  const fail = (m: string) => NextResponse.redirect(`${origin}/setup?error=${encodeURIComponent(m)}`);
  if (ctx.role !== "admin") return fail("Only a client admin can connect Xero.");
  const cfg = xeroConfigFromEnv(origin);
  if (!cfg) return fail("Xero isn't set up on the server yet.");
  const state = randomBytes(24).toString("base64url");
  const res = NextResponse.redirect(xeroAuthorizeUrl(cfg, state));
  res.cookies.set("xero_oauth_state", `${state}.${ctx.tenant.id}`, { httpOnly: true, secure: true, sameSite: "lax", path: "/api/connect/xero", maxAge: 600 });
  return res;
}
