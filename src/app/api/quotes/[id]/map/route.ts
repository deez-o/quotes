import { NextResponse } from "next/server";
import { ownQuote } from "@/lib/quote-access";
import type { Overview } from "@/lib/rfq/overview";
import { fetchStaticMap } from "@/lib/quote/static-map";

/** A satellite picture of the site with the drawn areas on it, for the overview PDF. */
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const got = await ownQuote<{ site_lat: number | null; site_lng: number | null; overview: Overview | null }>(id, "site_lat, site_lng, overview");
  if (!got || got.quote.site_lat == null || got.quote.site_lng == null) return NextResponse.json({ error: "No site location" }, { status: 404 });
  const img = await fetchStaticMap({ lat: got.quote.site_lat, lng: got.quote.site_lng }, got.quote.overview?.areas ?? []);
  if (!img) return NextResponse.json({ error: "Map failed" }, { status: 502 });
  return new NextResponse(Buffer.from(img), { headers: { "Content-Type": "image/png", "Cache-Control": "private, no-store" } });
}
