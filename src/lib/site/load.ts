import type { SupabaseClient } from "@supabase/supabase-js";
import { estimateHaul, type CostItem, type Haul, type HaulRoutes, type PricingSettings, type SiteScope, type SupplyPlant } from "./price";

export const DEFAULT_PRICING: PricingSettings = {
  truck_load_minutes: 15, truck_unload_minutes: 10, shift_minutes: 480, road_factor: 1.3, average_speed_kmh: 60, gst_percent: 10,
};

const optNum = (v: unknown) => (v == null ? null : Number(v));
const tiers = (v: unknown) => (Array.isArray(v) ? v.map((t) => ({ up_to: Number(t?.up_to), rate: Number(t?.rate) })).filter((t) => t.up_to > 0 && Number.isFinite(t.rate)) : null);
const nums = (c: CostItem) => ({ rate_tiers: tiers(c.rate_tiers), ordinary_hours: optNum(c.ordinary_hours), ot1_hours: optNum(c.ot1_hours), ot1_multiplier: optNum(c.ot1_multiplier), ot2_multiplier: optNum(c.ot2_multiplier) });

/** Everything a site quote is priced from, for one tenant (RLS applies). */
export async function loadPricingContext(db: SupabaseClient, tenantId: string) {
  const [{ data: items }, { data: plants }, { data: s }] = await Promise.all([
    db.from("cost_items").select("id, category, material_kind, name, unit, rate, density_t_per_m3, includes_delivery, truck_capacity_t, active, supply_plant_id, ordinary_hours, ot1_hours, ot1_multiplier, ot2_multiplier, rate_tiers")
      .eq("tenant_id", tenantId).order("name"),
    db.from("supply_plants").select("id, name, lat, lng").eq("tenant_id", tenantId).eq("active", true).order("name"),
    db.from("tenant_settings").select("margin_percent, truck_load_minutes, truck_unload_minutes, shift_minutes, road_factor, average_speed_kmh, gst_percent, quote_terms")
      .eq("tenant_id", tenantId).maybeSingle(),
  ]);
  const library = ((items ?? []) as CostItem[]).map((c) => ({ ...c, rate: Number(c.rate), density_t_per_m3: c.density_t_per_m3 == null ? null : Number(c.density_t_per_m3), truck_capacity_t: c.truck_capacity_t == null ? null : Number(c.truck_capacity_t), ...nums(c) }));
  const settings: PricingSettings = {
    truck_load_minutes: Number(s?.truck_load_minutes ?? DEFAULT_PRICING.truck_load_minutes),
    truck_unload_minutes: Number(s?.truck_unload_minutes ?? DEFAULT_PRICING.truck_unload_minutes),
    shift_minutes: Number(s?.shift_minutes ?? DEFAULT_PRICING.shift_minutes),
    road_factor: Number(s?.road_factor ?? DEFAULT_PRICING.road_factor),
    average_speed_kmh: Number(s?.average_speed_kmh ?? DEFAULT_PRICING.average_speed_kmh),
    gst_percent: Number(s?.gst_percent ?? DEFAULT_PRICING.gst_percent),
  };
  return {
    library,
    plants: (plants ?? []) as SupplyPlant[],
    settings,
    defaultMargin: Number(s?.margin_percent ?? 15),
    terms: (s?.quote_terms as string | null) ?? null,
  };
}

/** Haul for a scope: the user's override if set, else the road route to the chosen plant, else a straight-line estimate. */
export function haulFor(scope: SiteScope, site: { lat: number | null; lng: number | null }, plants: SupplyPlant[], settings: PricingSettings, routes?: HaulRoutes | null): Haul | null {
  if (scope.haul_override) return { ...scope.haul_override, source: "entered" };
  const route = scope.supply_plant_id ? routes?.[scope.supply_plant_id] : undefined;
  if (route) return { km: route.km, minutes: route.minutes, source: "road" };
  const plant = plants.find((p) => p.id === scope.supply_plant_id);
  if (!plant || site.lat == null || site.lng == null) return null;
  return estimateHaul({ lat: site.lat, lng: site.lng }, plant, settings);
}

export function emptyScope(title: string): SiteScope {
  return { title, job_type: "other", items: [], crew: [], plant: [], supply_plant_id: null, truck_cost_item_id: null, assumptions: [], questions: [], haul_override: null };
}
