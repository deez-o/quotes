import { randomUUID, timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { handleInbound, MAX_INBOUND_BYTES } from "@/lib/mail/inbound";
import { BUCKET } from "@/lib/worker/supabase-store";

/**
 * Receives emails forwarded to <customer>@<INBOUND_DOMAIN>.
 * The inbound email service POSTs the raw email (message/rfc822) with
 * "Authorization: Bearer <INBOUND_SECRET>" and the envelope recipient in ?to=.
 * Always answers quickly; unknown senders are dropped silently.
 */
export async function POST(request: NextRequest) {
  const secret = process.env.INBOUND_SECRET;
  const domain = process.env.INBOUND_DOMAIN;
  if (!secret || !domain) return NextResponse.json({ error: "not configured" }, { status: 503 });

  const given = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  }

  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > MAX_INBOUND_BYTES) return NextResponse.json({ error: "too large" }, { status: 413 });
  const raw = new Uint8Array(await request.arrayBuffer());

  let db;
  try {
    db = createAdminClient();
  } catch {
    return NextResponse.json({ error: "not configured" }, { status: 503 });
  }

  const result = await handleInbound(raw, request.nextUrl.searchParams.get("to"), {
    domain,
    newId: () => randomUUID(),
    tenantForLocalPart: async (local) => {
      const { data } = await db.from("inbound_addresses").select("tenant_id").eq("local_part", local).maybeSingle();
      return (data?.tenant_id as string | undefined) ?? null;
    },
    isTeamMember: async (tenantId, email) => {
      const { data } = await db.rpc("is_sender_member", { t: tenantId, sender: email });
      return data === true;
    },
    store: async (tenantId, inboundId, bytes) => {
      const path = `${tenantId}/inbound/${inboundId}.eml`;
      const { error } = await db.storage.from(BUCKET).upload(path, bytes, { contentType: "message/rfc822" });
      if (error) throw new Error(error.message);
      return path;
    },
    enqueue: async (tenantId, inboundId, path) => {
      const { error } = await db.from("queue_jobs").insert({
        tenant_id: tenantId, kind: "process_inbound", payload: { path, inbound_id: inboundId }, dedupe_key: `inbound:${inboundId}`,
      });
      if (error) throw new Error(error.message);
    },
  });

  return NextResponse.json(result.status === "queued" ? { status: "queued" } : { status: "ignored" }, { status: 200 });
}
