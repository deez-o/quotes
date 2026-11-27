import { randomUUID, timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { recipientLocalPart } from "@/lib/mail/inbound";
import { BUCKET } from "@/lib/worker/supabase-store";

/**
 * Step 1 for a forwarded email of any size: the Cloudflare worker asks where to put it, then uploads
 * the raw email straight to storage (no size limit on the way through Vercel), then calls
 * /api/inbound/email with the path. Unknown addresses get { ignore: true }.
 */
export async function POST(request: NextRequest) {
  const secret = process.env.INBOUND_SECRET;
  const domain = process.env.INBOUND_DOMAIN;
  if (!secret || !domain) return NextResponse.json({ error: "not configured" }, { status: 503 });
  const given = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return NextResponse.json({ error: "unauthorised" }, { status: 401 });

  const { to } = (await request.json().catch(() => ({}))) as { to?: string };
  const local = recipientLocalPart(domain, to ?? null, []);
  if (!local) return NextResponse.json({ ignore: true });
  let db;
  try { db = createAdminClient(); } catch { return NextResponse.json({ error: "not configured" }, { status: 503 }); }
  const { data } = await db.from("inbound_addresses").select("tenant_id").eq("local_part", local).maybeSingle();
  if (!data?.tenant_id) return NextResponse.json({ ignore: true });

  const id = randomUUID();
  const path = `${data.tenant_id}/inbound/${id}.eml`;
  const { data: up, error } = await db.storage.from(BUCKET).createSignedUploadUrl(path);
  if (error || !up) return NextResponse.json({ error: "storage unavailable" }, { status: 503 });
  return NextResponse.json({ id, path, uploadUrl: up.signedUrl });
}
