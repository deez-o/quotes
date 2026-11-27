import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

/** Where Microsoft sign-in returns to (and older email links). */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");
  const providerError = searchParams.get("error_description");

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(`${origin}/quotes`);
    return NextResponse.redirect(
      `${origin}/login?error=${encodeURIComponent("Sign-in link opened in a different browser. Please request a new link.")}`,
    );
  }

  return NextResponse.redirect(`${origin}/login?error=${encodeURIComponent(providerError ?? "Sign-in failed.")}`);
}
