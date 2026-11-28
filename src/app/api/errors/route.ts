import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { recordError } from "@/lib/errors";

/** Errors from the browser (the error screens report here). Signed-in people only. */
export async function POST(request: Request) {
  const db = await createClient();
  const { data } = await db.auth.getClaims();
  const userId = data?.claims?.sub ? String(data.claims.sub) : null;
  if (!userId) return NextResponse.json({ ok: false }, { status: 401 });
  const body = (await request.json().catch(() => ({}))) as { message?: unknown; digest?: unknown; path?: unknown; stack?: unknown };
  await recordError({
    where: "browser", message: String(body.message ?? "").slice(0, 1000), digest: body.digest ? String(body.digest) : null,
    path: body.path ? String(body.path) : null, userId, detail: { stack: body.stack ? String(body.stack).slice(0, 3000) : undefined, agent: request.headers.get("user-agent")?.slice(0, 200) },
  });
  return NextResponse.json({ ok: true });
}
