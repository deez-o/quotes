/** A made-up job, priced the real way, for the sample workbook (no customer data). */
import { priceSiteQuote, type CostItem, type SiteScope } from "@/lib/site/price";
import type { WorkingsInput } from "./default";
import { SAMPLE_QUOTE, type SheetQuote } from "./map";

/** The sample customer quote, from the same sample job as the workings. */
export function sampleQuoteFor(w: WorkingsInput): SheetQuote {
  const p = w.priced;
  return {
    values: { ...SAMPLE_QUOTE.values, subtotal_ex_gst: p.priceExGst, gst: p.gst, total_inc_gst: p.priceIncGst },
    lines: p.customerLines.map((l) => ({ description: l.description, quantity: l.quantity, unit: l.unit, rate: l.rate, total: l.total })),
  };
}

const ci = (o: Partial<CostItem> & Pick<CostItem, "id" | "category" | "name" | "unit" | "rate">): CostItem => ({
  material_kind: null, density_t_per_m3: null, includes_delivery: false, truck_capacity_t: null, active: true, ...o,
});

export function sampleWorkings(): WorkingsInput {
  const library: CostItem[] = [
    ci({ id: "ac10", category: "material", material_kind: "asphalt", name: "AC10", unit: "t", rate: 150, density_t_per_m3: 2.4 }),
    ci({ id: "tack", category: "material", material_kind: "prime", name: "Tack coat", unit: "m2", rate: 0.45 }),
    ci({ id: "prof", category: "other", name: "Profiling 40 mm", unit: "m2", rate: 2.6 }),
    ci({ id: "truck", category: "truck", name: "Tipper", unit: "h", rate: 140, truck_capacity_t: 12 }),
    ci({ id: "crew", category: "crew", name: "Asphalt crew", unit: "h", rate: 1200, ordinary_hours: 8, ot1_hours: 2, ot1_multiplier: 1.5, ot2_multiplier: 2 }),
    ci({ id: "roller", category: "plant", name: "Multi-tyre roller", unit: "day", rate: 650 }),
    ci({ id: "float", category: "float", name: "Float", unit: "each", rate: 650 }),
  ];
  const scope = {
    title: "Kerr Rd carpark", job_type: "carpark", site_location: null, assumptions: [], questions: [], haul_override: null,
    supply_plant_id: null, truck_cost_item_id: "truck", float_moves: 1,
    items: [
      { key: "a", kind: "asphalt", description: "Supply and lay AC10, 40 mm", area_m2: 1850, depth_mm: 40, quantity: null, cost_item_id: "ac10" },
      { key: "p", kind: "other", description: "Profile existing surface, 40 mm", area_m2: 1850, depth_mm: null, quantity: null, cost_item_id: "prof" },
      { key: "t", kind: "prime", description: "Tack coat", area_m2: 1850, depth_mm: null, quantity: null, cost_item_id: "tack" },
    ],
    crew: [{ key: "c", cost_item_id: "crew", amount: 10, days: 1, note: null }],
    plant: [{ key: "r", cost_item_id: "roller", amount: 1, days: 1, note: null }],
  } as unknown as SiteScope;
  const haul = { km: 21, minutes: 24, source: "road" as const };
  const settings = { truck_load_minutes: 10, truck_unload_minutes: 10, shift_minutes: 600, road_factor: 1.3, average_speed_kmh: 60, gst_percent: 10 };
  return { priced: priceSiteQuote({ scope, library, settings, haul, marginPercent: 15 }), marginPercent: 15, plant: "Narangba plant", haul: { km: 21, minutes: 24 } };
}
