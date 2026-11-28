import { NextResponse } from "next/server";
import { requireTenant } from "@/lib/tenant";
import { createClient } from "@/lib/supabase/server";
import { routeMapUrl, yardRoute } from "@/lib/site/yard-route";

/** The yard-to-job map for the job overview (?view=route or site), fetched here so the maps key stays private. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const view = new URL(req.url).searchParams.get("view") === "site" ? "site" : "route";
  const ctx = await requireTenant();
  const db = await createClient();
  const [{ data: q }, { data: s }] = await Promise.all([
    db.from("site_quotes").select("site_lat, site_lng").eq("tenant_id", ctx.tenant.id).eq("id", id).maybeSingle(),
    db.from("tenant_settings").select("base_lat, base_lng").eq("tenant_id", ctx.tenant.id).maybeSingle(),
  ]);
  if (q?.site_lat == null || q?.site_lng == null) return new NextResponse(null, { status: 404 });
  const to = { lat: Number(q.site_lat), lng: Number(q.site_lng) };
  const from = s?.base_lat != null && s?.base_lng != null ? { lat: Number(s.base_lat), lng: Number(s.base_lng) } : to;
  const route = view === "route" && from !== to ? await yardRoute(from, to) : null;
  const url = routeMapUrl(view, from, to, route?.polyline ?? null);
  if (!url) return new NextResponse(null, { status: 404 });
  const r = await fetch(url, { signal: AbortSignal.timeout(15_000) }).catch(() => null);
  if (!r?.ok) return new NextResponse(null, { status: 502 });
  return new NextResponse(Buffer.from(await r.arrayBuffer()), { headers: { "Content-Type": "image/png", "Cache-Control": "private, max-age=3600" } });
}
