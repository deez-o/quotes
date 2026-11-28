import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { buildHandlers } from "@/lib/worker/handlers";
import { runWorkerOnce, supabaseQueue } from "@/lib/worker/run";

/**
 * Runs every minute (vercel.json cron) for the pilot: works through queued jobs
 * and queues renewals for mailbox subscriptions that expire within a day.
 * Called every minute by the Supabase timer (supabase/ops/worker_timer.sql), or Vercel cron with CRON_SECRET.
 */
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const auth = request.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (token.length < 16) return NextResponse.json({ error: "unauthorised" }, { status: 401 });

  let db;
  try {
    db = createAdminClient();
  } catch {
    return NextResponse.json({ error: "not configured" }, { status: 503 });
  }

  // Either Vercel's cron (CRON_SECRET) or the Supabase timer (token kept in Supabase Vault).
  const secret = process.env.CRON_SECRET;
  let ok = !!secret && token === secret;
  if (!ok) {
    const { data } = await db.rpc("check_worker_token", { t: token });
    ok = data === true;
  }
  if (!ok) return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? request.nextUrl.origin;

  // Renewals: queue one per watch expiring in the next 24 hours (deduped per day).
  const soon = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
  const { data: expiring } = await db.from("mail_watches").select("tenant_id, connection_id").lt("expires_at", soon);
  if (expiring?.length) {
    const day = new Date().toISOString().slice(0, 10);
    await db.from("queue_jobs").upsert(
      expiring.map((w) => ({
        tenant_id: w.tenant_id, kind: "renew_watch", payload: { connection_id: w.connection_id },
        dedupe_key: `renew:${w.connection_id}:${day}`,
      })),
      { onConflict: "tenant_id,dedupe_key", ignoreDuplicates: true },
    );
  }

  // Hourly: check Xero for quotes accepted or declined there (each company with Xero connected).
  const now = new Date();
  if (now.getUTCMinutes() === 7) {
    const { data: xero } = await db.from("connections").select("tenant_id").eq("provider", "xero").eq("status", "ok");
    const hour = now.toISOString().slice(0, 13);
    const tenants = [...new Set((xero ?? []).map((c) => c.tenant_id as string))];
    if (tenants.length) await db.from("queue_jobs").upsert(
      tenants.map((t) => ({ tenant_id: t, kind: "xero_sync", payload: {}, dedupe_key: `xero:${hour}` })),
      { onConflict: "tenant_id,dedupe_key", ignoreDuplicates: true },
    );
  }
  // Daily (7:13am Brisbane): TMR's monthly bitumen index.
  if (now.getUTCHours() === 21 && now.getUTCMinutes() === 13) {
    const { syncTmrIndex } = await import("@/lib/bitumen-sync");
    await syncTmrIndex(db).catch(() => null);
  }

  const summary = await runWorkerOnce(supabaseQueue(db), buildHandlers(db, siteUrl), 20);
  return NextResponse.json({ ...summary, renewalsQueued: expiring?.length ?? 0 });
}
