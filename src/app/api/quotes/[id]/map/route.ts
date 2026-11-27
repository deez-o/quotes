import { NextResponse } from "next/server";
import { ownQuote } from "@/lib/quote-access";
import type { Overview } from "@/lib/rfq/overview";

/** A satellite picture of the site with the drawn areas on it, for the overview PDF. */
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const got = await ownQuote<{ site_lat: number | null; site_lng: number | null; overview: Overview | null }>(id, "site_lat, site_lng, overview");
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!got || got.quote.site_lat == null || got.quote.site_lng == null || !key) return NextResponse.json({ error: "No site location" }, { status: 404 });
  const q = got.quote;
  const u = new URL("https://maps.googleapis.com/maps/api/staticmap");
  u.searchParams.set("size", "640x400");
  u.searchParams.set("scale", "2");
  u.searchParams.set("maptype", "hybrid");
  const areas = q.overview?.areas ?? [];
  if (!areas.length) {
    u.searchParams.set("center", `${q.site_lat},${q.site_lng}`);
    u.searchParams.set("zoom", "18");
  }
  u.searchParams.append("markers", `color:0xFF6A13|${q.site_lat},${q.site_lng}`);
  for (const a of areas.slice(0, 20)) {
    const hex = a.color.replace("#", "0x");
    const pts = [...a.path, a.path[0]].map(([lat, lng]) => `${lat.toFixed(6)},${lng.toFixed(6)}`).join("|");
    u.searchParams.append("path", `color:${hex}ff|weight:3|fillcolor:${hex}55|${pts}`);
  }
  u.searchParams.set("key", key);
  const img = await fetch(u);
  if (!img.ok) return NextResponse.json({ error: "Map failed" }, { status: 502 });
  return new NextResponse(await img.arrayBuffer(), { headers: { "Content-Type": img.headers.get("content-type") ?? "image/png", "Cache-Control": "private, no-store" } });
}
