import { NextResponse } from "next/server";
import { ownQuote } from "@/lib/quote-access";

/**
 * A Street View photo of the job site, fetched with the server's key so the key never reaches
 * the browser. ?h= is the compass heading (0 north, 90 east...). 404 when Google has no imagery there.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const got = await ownQuote<{ site_lat: number | null; site_lng: number | null }>(id, "site_lat, site_lng");
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!got || got.quote.site_lat == null || got.quote.site_lng == null || !key) return NextResponse.json({ error: "No site location" }, { status: 404 });
  const h = Math.round(Number(new URL(request.url).searchParams.get("h") ?? 0)) % 360;
  const loc = `${got.quote.site_lat},${got.quote.site_lng}`;
  const meta = await fetch(`https://maps.googleapis.com/maps/api/streetview/metadata?location=${loc}&radius=80&source=outdoor&key=${key}`).then((r) => r.json()).catch(() => null) as { status?: string } | null;
  if (meta?.status !== "OK") return NextResponse.json({ error: "No Street View here" }, { status: 404 });
  const img = await fetch(`https://maps.googleapis.com/maps/api/streetview?size=640x400&location=${loc}&radius=80&source=outdoor&fov=90&pitch=-5&heading=${h}&key=${key}`);
  if (!img.ok) return NextResponse.json({ error: "Street View failed" }, { status: 502 });
  return new NextResponse(await img.arrayBuffer(), { headers: { "Content-Type": img.headers.get("content-type") ?? "image/jpeg", "Cache-Control": "private, max-age=86400" } });
}
