import type { DrawnArea } from "@/lib/rfq/overview";

/** A Google Static Maps picture of the site, with the traced areas drawn on it. */
export function staticMapUrl(site: { lat: number; lng: number }, areas: DrawnArea[], key: string): string {
  const u = new URL("https://maps.googleapis.com/maps/api/staticmap");
  u.searchParams.set("size", "640x400");
  u.searchParams.set("scale", "2");
  u.searchParams.set("maptype", "hybrid");
  u.searchParams.set("format", "png");
  if (!areas.length) {
    u.searchParams.set("center", `${site.lat},${site.lng}`);
    u.searchParams.set("zoom", "18");
  }
  u.searchParams.append("markers", `color:0xFF6A13|${site.lat},${site.lng}`);
  for (const a of areas.slice(0, 20)) {
    const hex = a.color.replace("#", "0x");
    const pts = [...a.path, a.path[0]].map(([lat, lng]) => `${lat.toFixed(6)},${lng.toFixed(6)}`).join("|");
    u.searchParams.append("path", `color:${hex}ff|weight:3|fillcolor:${hex}55|${pts}`);
  }
  u.searchParams.set("key", key);
  return u.toString();
}

export async function fetchStaticMap(site: { lat: number; lng: number }, areas: DrawnArea[]): Promise<Uint8Array | null> {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) return null;
  try {
    const r = await fetch(staticMapUrl(site, areas, key), { signal: AbortSignal.timeout(15_000) });
    if (!r.ok || !(r.headers.get("content-type") ?? "").startsWith("image/png")) return null;
    return new Uint8Array(await r.arrayBuffer());
  } catch {
    return null;
  }
}
