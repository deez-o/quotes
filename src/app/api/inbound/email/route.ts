import { randomUUID, timingSafeEqual } from "node:crypto";
import { loadAccess } from "@/lib/access-load";
import { planFor } from "@/lib/plans";
import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { handleInbound, MAX_INBOUND_BYTES } from "@/lib/mail/inbound";
import { BUCKET } from "@/lib/worker/supabase-store";

/**
 * Receives emails forwarded to <customer>@<INBOUND_DOMAIN>, with "Authorization: Bearer <INBOUND_SECRET>".
 * Either the raw email (message/rfc822) with the envelope recipient in ?to=, or JSON {path, id, to}
 * for an email the Cloudflare worker already uploaded to storage via /api/inbound/start.
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

  let db;
  try {
    db = createAdminClient();
  } catch {
    return NextResponse.json({ error: "not configured" }, { status: 503 });
  }

  // Two ways in: the raw email in the body (small emails), or JSON naming an email the
  // worker already uploaded straight to storage (any size; see /api/inbound/start).
  let raw: Uint8Array;
  let to = request.nextUrl.searchParams.get("to");
  let stored: { path: string; id: string } | null = null;
  if ((request.headers.get("content-type") ?? "").startsWith("application/json")) {
    const body = (await request.json().catch(() => ({}))) as { path?: string; id?: string; to?: string };
    const m = /^([0-9a-f-]{36})\/inbound\/([0-9a-f-]{36})\.eml$/i.exec(body.path ?? "");
    if (!m || m[2] !== body.id) return NextResponse.json({ error: "bad path" }, { status: 400 });
    const { data, error } = await db.storage.from(BUCKET).download(body.path!);
    if (error || !data) return NextResponse.json({ error: "not uploaded" }, { status: 400 });
    if (data.size > MAX_INBOUND_BYTES) {
      await db.storage.from(BUCKET).remove([body.path!]);
      return NextResponse.json({ status: "ignored" }, { status: 200 });
    }
    raw = new Uint8Array(await data.arrayBuffer());
    to = body.to ?? to;
    stored = { path: body.path!, id: body.id! };
  } else {
    const length = Number(request.headers.get("content-length") ?? 0);
    if (length > MAX_INBOUND_BYTES) return NextResponse.json({ error: "too large" }, { status: 413 });
    raw = new Uint8Array(await request.arrayBuffer());
  }

  const result = await handleInbound(raw, to, {
    domain,
    newId: () => stored?.id ?? randomUUID(),
    tenantForLocalPart: async (local) => {
      const { data } = await db.from("inbound_addresses").select("tenant_id").eq("local_part", local).maybeSingle();
      const tenantId = (data?.tenant_id as string | undefined) ?? null;
      if (!tenantId) return null;
      // Forwarded RFQs are a Pro feature, and only while the company's trial or plan is current.
      const { tenant, access } = await loadAccess(tenantId);
      if (access.state === "locked" || !planFor(tenant.plan).emailAutoQuote) return null;
      return tenantId;
    },
    isTeamMember: async (tenantId, email) => {
      const { data } = await db.rpc("is_sender_member", { t: tenantId, sender: email });
      return data === true;
    },
    store: async (tenantId, inboundId, bytes) => {
      if (stored) {
        if (!stored.path.startsWith(`${tenantId}/`)) throw new Error("stored under another company");
        return stored.path;
      }
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

  // Not for us (unknown sender or address): don't keep the uploaded copy.
  if (result.status !== "queued" && stored) await db.storage.from(BUCKET).remove([stored.path]);
  return NextResponse.json(result.status === "queued" ? { status: "queued" } : { status: "ignored" }, { status: 200 });
}
