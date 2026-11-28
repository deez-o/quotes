import "server-only";
import { truckMinutes } from "@/lib/maps";

type LatLng = { lat: number; lng: number };
export type YardRoute = { km: number; carMinutes: number; truckMinutes: number; polyline: string | null };

/** The road from their yard to the job: distance, drive time and the line to draw (Google Routes). */
export async function yardRoute(from: LatLng, to: LatLng): Promise<YardRoute | null> {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) return null;
  try {
    const res = await fetch("https://routes.googleapis.com/directions/v2:computeRoutes", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Goog-Api-Key": key, "X-Goog-FieldMask": "routes.distanceMeters,routes.duration,routes.polyline.encodedPolyline" },
      body: JSON.stringify({
        origin: { location: { latLng: { latitude: from.lat, longitude: from.lng } } },
        destination: { location: { latLng: { latitude: to.lat, longitude: to.lng } } },
        travelMode: "DRIVE", routingPreference: "TRAFFIC_UNAWARE", regionCode: "AU", polylineQuality: "OVERVIEW",
      }),
      signal: AbortSignal.timeout(12_000),
    });
    const data = (await res.json()) as { routes?: { distanceMeters?: number; duration?: string; polyline?: { encodedPolyline?: string } }[] };
    const r = data.routes?.[0];
    if (!res.ok || !r?.distanceMeters) return null;
    const car = Math.round(Number(String(r.duration ?? "0s").replace("s", "")) / 60);
    return { km: Math.round(r.distanceMeters / 100) / 10, carMinutes: car, truckMinutes: truckMinutes(car), polyline: r.polyline?.encodedPolyline ?? null };
  } catch {
    return null;
  }
}

/** A map picture: the whole route with the yard and the site marked, or a close-up of the site. */
export function routeMapUrl(view: "route" | "site", from: LatLng, to: LatLng, polyline: string | null): string | null {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) return null;
  const u = new URL("https://maps.googleapis.com/maps/api/staticmap");
  u.searchParams.set("size", view === "route" ? "640x520" : "640x520");
  u.searchParams.set("scale", "2");
  u.searchParams.set("format", "png");
  u.searchParams.set("maptype", view === "route" ? "roadmap" : "hybrid");
  if (view === "route") {
    u.searchParams.append("markers", `color:0x16181B|label:Y|${from.lat},${from.lng}`);
    u.searchParams.append("markers", `color:0xFF6A13|label:J|${to.lat},${to.lng}`);
    if (polyline) u.searchParams.append("path", `color:0xFF6A13ff|weight:5|enc:${polyline}`);
  } else {
    u.searchParams.set("center", `${to.lat},${to.lng}`);
    u.searchParams.set("zoom", "16");
    u.searchParams.append("markers", `color:0xFF6A13|${to.lat},${to.lng}`);
  }
  u.searchParams.set("key", key);
  return u.toString();
}
