import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { handleGraphNotifications } from "@/lib/mail/notifications";
import { graphClientState } from "@/lib/microsoft/oauth";

/**
 * Microsoft Graph posts new-mail notifications here.
 * Short and fast: it never downloads anything, it only queues a job.
 * Public route (excluded from the sign-in check in proxy.ts).
 */
export async function POST(request: NextRequest) {
  // Subscription handshake: echo the token back as plain text within 10 seconds.
  const validationToken = request.nextUrl.searchParams.get("validationToken");
  if (validationToken) {
    return new NextResponse(validationToken, { status: 200, headers: { "Content-Type": "text/plain" } });
  }

  const clientState = graphClientState();
  if (!clientState) return NextResponse.json({ error: "not configured" }, { status: 503 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }

  let admin;
  try {
    admin = createAdminClient();
  } catch {
    // Graph retries with back-off, so a 503 here loses nothing.
    return NextResponse.json({ error: "not configured" }, { status: 503 });
  }

  const result = await handleGraphNotifications(body, {
    clientState,
    findWatch: async (subscriptionId) => {
      const { data } = await admin
        .from("mail_watches")
        .select("tenant_id, connection_id")
        .eq("subscription_id", subscriptionId)
        .maybeSingle();
      return data ?? null;
    },
    enqueue: async (jobs) => {
      const { error } = await admin
        .from("queue_jobs")
        .upsert(jobs, { onConflict: "tenant_id,dedupe_key", ignoreDuplicates: true });
      if (error) throw new Error(error.message);
    },
  });

  return NextResponse.json(result, { status: 202 });
}
