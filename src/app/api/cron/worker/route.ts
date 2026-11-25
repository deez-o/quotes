import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { buildHandlers } from "@/lib/worker/handlers";
import { runWorkerOnce, supabaseQueue } from "@/lib/worker/run";

/**
 * Runs every minute (vercel.json cron) for the pilot: works through queued jobs
 * and queues renewals for mailbox subscriptions that expire within a day.
 * Vercel sends "Authorization: Bearer <CRON_SECRET>" when CRON_SECRET is set.
 */
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  }

  let db;
  try {
    db = createAdminClient();
  } catch {
    return NextResponse.json({ error: "not configured" }, { status: 503 });
  }
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

  const summary = await runWorkerOnce(supabaseQueue(db), buildHandlers(db, siteUrl), 20);
  return NextResponse.json({ ...summary, renewalsQueued: expiring?.length ?? 0 });
}
