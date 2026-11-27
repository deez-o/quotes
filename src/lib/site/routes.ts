import "server-only";
import { roadRoute, truckMinutes } from "@/lib/maps";
import type { HaulRoutes, SupplyPlant } from "./price";

/**
 * Road distance from the site to each plant with a location (server only: uses the maps key).
 * Drive times are for cars, so they're scaled up for loaded trucks. Plants that can't be
 * routed are left out and fall back to the straight-line estimate.
 */
export async function routesToPlants(site: { lat: number | null; lng: number | null }, plants: SupplyPlant[], fetchImpl?: typeof fetch): Promise<HaulRoutes | null> {
  if (site.lat == null || site.lng == null) return null;
  const apiKey = process.env.GOOGLE_MAPS_API_KEY || null;
  const out: HaulRoutes = {};
  await Promise.all(plants.filter((p) => p.lat != null && p.lng != null).slice(0, 8).map(async (p) => {
    try {
      const r = await roadRoute({ lat: site.lat!, lng: site.lng! }, { lat: p.lat!, lng: p.lng! }, { apiKey, fetchImpl });
      if (r) out[p.id] = { km: r.km, minutes: truckMinutes(r.minutes), source: r.source };
    } catch { /* fall back to the estimate for this plant */ }
  }));
  return Object.keys(out).length ? out : null;
}
