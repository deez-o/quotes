import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { CHECK_COOKIE, CHECK_EVERY_S, DEVICE_COOKIE, deviceLabel, whereFrom } from "@/lib/devices";
import { checkDevice } from "@/lib/device-check";

const PUBLIC_PATHS = ["/login", "/auth", "/signup"]; // /auth/session, /auth/callback, /auth/confirm

/**
 * Runs before every page: refreshes the Supabase session cookie and sends
 * anyone who isn't signed in to /login.
 */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return response; // not configured yet; pages show the setup error

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        );
        Object.entries(headers).forEach(([k, v]) => response.headers.set(k, v));
      },
    },
  });

  const { data } = await supabase.auth.getClaims();
  const signedIn = Boolean(data?.claims?.sub);
  const isPublic = PUBLIC_PATHS.some((p) => request.nextUrl.pathname.startsWith(p));

  if (!signedIn && !isPublic) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.search = "";
    return NextResponse.redirect(loginUrl);
  }

  // Every few minutes: record this device, and sign it out if it was ended or the account is suspended.
  if (signedIn && !isPublic && !request.cookies.get(CHECK_COOKIE) && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    const deviceId = request.cookies.get(DEVICE_COOKIE)?.value || crypto.randomUUID();
    let result: Awaited<ReturnType<typeof checkDevice>> = { ok: true };
    try {
      result = await checkDevice({
        userId: String(data!.claims.sub),
        sessionId: (data!.claims.session_id as string | undefined) ?? null,
        deviceId,
        label: deviceLabel(request.headers.get("user-agent")),
        where: whereFrom(request.headers),
      });
    } catch {
      // Never lock people out because the check itself failed.
    }
    if (!result.ok) {
      await supabase.auth.signOut({ scope: "local" });
      const loginUrl = request.nextUrl.clone();
      loginUrl.pathname = "/login";
      loginUrl.search = `?m=${result.reason}`;
      const out = NextResponse.redirect(loginUrl);
      response.cookies.getAll().forEach((c) => out.cookies.set(c));
      return out;
    }
    const year = 400 * 24 * 3600;
    response.cookies.set(DEVICE_COOKIE, deviceId, { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: year });
    response.cookies.set(CHECK_COOKIE, "1", { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: CHECK_EVERY_S });
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|.*\\.png$|.*\\.svg$|api/webhooks|api/cron|api/inbound|api/stripe).*)"],
};
