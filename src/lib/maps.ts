/**
 * Place search and road routing. Uses Google (Places API "Text Search" and the
 * Routes API) when GOOGLE_MAPS_API_KEY is set; otherwise free OpenStreetMap
 * services (Nominatim search, OSRM routing), which are fine for light pilot use
 * but weaker at finding businesses by name. Server-side only (the key stays secret).
 */

export type Place = { name: string; address: string; lat: number; lng: number; source: "google" | "osm" };
export type Route = { km: number; minutes: number; source: "google" | "osm" };
type LatLng = { lat: number; lng: number };

const UA = "QUOTES estimating app (plant and site locations)";

export async function searchPlaces(query: string, opts: { apiKey?: string | null; fetchImpl?: typeof fetch; near?: LatLng | null } = {}): Promise<Place[]> {
  const q = query.trim();
  if (q.length < 3) return [];
  const f = opts.fetchImpl ?? fetch;

  if (opts.apiKey) {
    const res = await f("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": opts.apiKey,
        "X-Goog-FieldMask": "places.displayName,places.formattedAddress,places.location",
      },
      body: JSON.stringify({
        textQuery: q,
        regionCode: "AU",
        maxResultCount: 6,
        ...(opts.near ? { locationBias: { circle: { center: { latitude: opts.near.lat, longitude: opts.near.lng }, radius: 50000 } } } : {}),
      }),
    });
    const data = (await res.json()) as {
      places?: { displayName?: { text?: string }; formattedAddress?: string; location?: { latitude: number; longitude: number } }[];
      error?: { message?: string };
    };
    if (!res.ok) throw new Error(`Google search failed: ${data.error?.message ?? res.status}`);
    return (data.places ?? [])
      .filter((p) => p.location)
      .map((p) => ({
        name: p.displayName?.text ?? q,
        address: p.formattedAddress ?? "",
        lat: p.location!.latitude,
        lng: p.location!.longitude,
        source: "google" as const,
      }));
  }

  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=6&countrycodes=au&q=${encodeURIComponent(q)}`;
  const res = await f(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`Map search failed (${res.status}).`);
  const hits = (await res.json()) as { name?: string; display_name: string; lat: string; lon: string }[];
  return hits.map((h) => ({
    name: h.name || h.display_name.split(",")[0],
    address: h.display_name,
    lat: Number(h.lat),
    lng: Number(h.lon),
    source: "osm" as const,
  }));
}

export async function roadRoute(from: LatLng, to: LatLng, opts: { apiKey?: string | null; fetchImpl?: typeof fetch } = {}): Promise<Route | null> {
  const f = opts.fetchImpl ?? fetch;

  if (opts.apiKey) {
    const res = await f("https://routes.googleapis.com/directions/v2:computeRoutes", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": opts.apiKey,
        "X-Goog-FieldMask": "routes.distanceMeters,routes.duration",
      },
      body: JSON.stringify({
        origin: { location: { latLng: { latitude: from.lat, longitude: from.lng } } },
        destination: { location: { latLng: { latitude: to.lat, longitude: to.lng } } },
        travelMode: "DRIVE",
        routingPreference: "TRAFFIC_UNAWARE",
        regionCode: "AU",
      }),
    });
    const data = (await res.json()) as { routes?: { distanceMeters?: number; duration?: string }[]; error?: { message?: string } };
    if (!res.ok) throw new Error(`Google routing failed: ${data.error?.message ?? res.status}`);
    const r = data.routes?.[0];
    if (!r?.distanceMeters) return null;
    const seconds = Number(String(r.duration ?? "0s").replace("s", ""));
    return { km: Math.round(r.distanceMeters / 100) / 10, minutes: Math.round(seconds / 60), source: "google" };
  }

  const url = `https://router.project-osrm.org/route/v1/driving/${from.lng},${from.lat};${to.lng},${to.lat}?overview=false`;
  const res = await f(url, { headers: { "User-Agent": UA } });
  if (!res.ok) return null;
  const data = (await res.json()) as { code?: string; routes?: { distance: number; duration: number }[] };
  const r = data.code === "Ok" ? data.routes?.[0] : undefined;
  if (!r) return null;
  return { km: Math.round(r.distance / 100) / 10, minutes: Math.round(r.duration / 60), source: "osm" };
}

/** Trucks are slower than cars: scale the drive time by the customer's truck factor. */
export function truckMinutes(carMinutes: number, factor = 1.15): number {
  return Math.round(carMinutes * factor);
}
