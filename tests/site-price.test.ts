import { describe, expect, it } from "vitest";
import {
  estimateHaul, haversineKm, priceSiteQuote, tonnesFor, type CostItem, type PricingSettings, type SiteScope,
} from "@/lib/site/price";

/** Demo Asphalt Co's costs library (made up; matches supabase/seed.sql). */
const lib: CostItem[] = [
  { id: "crew", category: "crew", material_kind: null, name: "Asphalt crew", unit: "shift", rate: 9500, density_t_per_m3: null, includes_delivery: false, truck_capacity_t: null, active: true },
  { id: "ac10", category: "material", material_kind: "asphalt", name: "AC10 asphalt", unit: "t", rate: 150, density_t_per_m3: 2.4, includes_delivery: false, truck_capacity_t: null, active: true },
  { id: "base", category: "material", material_kind: "base", name: "Crushed rock base", unit: "t", rate: 45, density_t_per_m3: 2.2, includes_delivery: true, truck_capacity_t: null, active: true },
  { id: "prime", category: "material", material_kind: "prime", name: "Prime", unit: "m2", rate: 1.8, density_t_per_m3: null, includes_delivery: false, truck_capacity_t: null, active: true },
  { id: "bobcat", category: "plant", material_kind: null, name: "Bobcat", unit: "h", rate: 120, density_t_per_m3: null, includes_delivery: false, truck_capacity_t: null, active: true },
  { id: "truck", category: "truck", material_kind: null, name: "Truck and driver (12 t)", unit: "h", rate: 140, density_t_per_m3: null, includes_delivery: false, truck_capacity_t: 12, active: true },
];

const settings: PricingSettings = {
  truck_load_minutes: 15, truck_unload_minutes: 10, shift_minutes: 480, road_factor: 1.3, average_speed_kmh: 60, gst_percent: 10,
};

/** The carpark from the phone mock-ups. */
const carpark = (): SiteScope => ({
  title: "Carpark, Capalaba",
  job_type: "carpark",
  items: [
    { key: "i1", kind: "asphalt", description: "Supply and lay AC10, 40 mm", area_m2: 2000, depth_mm: 40, cost_item_id: "ac10", quantity: null },
    { key: "i2", kind: "base", description: "Base repair, 100 mm crushed rock", area_m2: 60, depth_mm: 100, cost_item_id: "base", quantity: null },
    { key: "i3", kind: "prime", description: "Prime", area_m2: 2000, depth_mm: null, cost_item_id: "prime", quantity: null },
  ],
  crew: [{ key: "c1", cost_item_id: "crew", amount: 1, note: "carpark, one day" }],
  plant: [{ key: "p1", cost_item_id: "bobcat", amount: 6, note: null }],
  supply_plant_id: "narangba",
  truck_cost_item_id: "truck",
  assumptions: [],
  questions: [],
});

describe("site-quote pricing", () => {
  it("prices the carpark from the mock-up", () => {
    const p = priceSiteQuote({ scope: carpark(), library: lib, settings, haul: { km: 38, minutes: 42, source: "entered" }, marginPercent: 15 });

    const byKey = Object.fromEntries(p.costLines.map((l) => [l.key, l.cost]));
    expect(byKey.i1).toBe(28800);          // 192 t × $150
    expect(byKey.i2).toBe(594);            // 6 m³ × 2.2 = 13.2 t × $45 (delivered, no trucks)
    expect(byKey.i3).toBe(3600);           // 2,000 m² × $1.80
    expect(p.trucks).toEqual({ loads: 16, trucks: 4, cycleMinutes: 109, hours: 29.07, tonnes: 192 });
    expect(byKey.trucks).toBe(4069.8);     // 29.07 h × $140
    expect(byKey.c1).toBe(9500);
    expect(byKey.p1).toBe(720);

    expect(p.cost).toBe(47283.8);
    expect(p.priceExGst).toBe(55628);      // cost ÷ 0.85, to the dollar
    expect(p.gst).toBe(5562.8);
    expect(p.priceIncGst).toBe(61190.8);
    expect(p.warnings).toEqual([]);

    // Customer lines add up exactly and hide trucks/crew inside the rates.
    expect(p.customerLines.map((l) => l.description)).toEqual(["Base repair, 100 mm crushed rock", "Prime", "Supply and lay AC10, 40 mm"]); // the order the work is done
    expect(p.customerLines.reduce((s, l) => s + l.total, 0)).toBe(p.priceExGst);
    expect(p.customerLines[2]).toMatchObject({ quantity: 192, unit: "t" }); // asphalt quoted per tonne
    expect(p.customerLines[1]).toMatchObject({ quantity: 2000, unit: "m²" });
    // Per tonne: price matches the asphalt line; profit = price - cost; profit per shift from 1 crew shift.
    expect(p.perTonne?.tonnes).toBe(192);
    expect(p.perTonne?.price).toBeCloseTo(p.customerLines[2].total / 192, 2);
    expect(p.perTonne!.price - p.perTonne!.cost).toBeCloseTo(p.perTonne!.profit, 1);
    expect(p.shifts).toBe(1);
    expect(p.profitPerShift).toBe(p.profit);
  });

  it("shows its working", () => {
    const p = priceSiteQuote({ scope: carpark(), library: lib, settings, haul: { km: 38, minutes: 42, source: "entered" }, marginPercent: 15 });
    expect(p.costLines.find((l) => l.key === "i1")?.working).toBe("2,000 m² × 0.04 m × 2.4 t/m³ = 192 t × $150/t");
    expect(p.costLines.find((l) => l.key === "trucks")?.working).toContain("16 loads × 109 min cycle");
  });

  it("moves the price with the margin, not the cost", () => {
    const at = (m: number) => priceSiteQuote({ scope: carpark(), library: lib, settings, haul: { km: 38, minutes: 42, source: "entered" }, marginPercent: m });
    expect(at(0).priceExGst).toBe(47284);
    expect(at(20).priceExGst).toBe(59105);
    expect(at(20).cost).toBe(at(0).cost);
  });

  it("warns instead of guessing", () => {
    const s = carpark();
    s.items.push({ key: "i4", kind: "other", description: "Line marking", area_m2: null, depth_mm: null, cost_item_id: null, quantity: null });
    const p = priceSiteQuote({ scope: s, library: lib, settings, haul: null, marginPercent: 15 });
    expect(p.warnings).toContain('"Line marking" has no matching cost in your library, so it isn\'t priced.');
    expect(p.warnings.some((w) => w.startsWith("Distance to the plant is unknown"))).toBe(true);
    expect(p.trucks).toBeNull();
  });

  it("one shift job with few loads needs one truck", () => {
    const s = carpark();
    s.items = [{ key: "i1", kind: "asphalt", description: "Driveway AC10 30 mm", area_m2: 80, depth_mm: 30, cost_item_id: "ac10", quantity: null }];
    const p = priceSiteQuote({ scope: s, library: lib, settings, haul: { km: 10, minutes: 12, source: "entered" }, marginPercent: 25 });
    expect(p.trucks).toMatchObject({ loads: 1, trucks: 1 });
    expect(p.customerLines).toHaveLength(1);
    expect(p.customerLines[0].total).toBe(p.priceExGst);
  });
});

describe("haul from GPS", () => {
  it("works out road distance and minutes from the site to the plant", () => {
    expect(haversineKm(-27.2016, 152.9621, -27.5303, 153.1979)).toBeCloseTo(43.0, 0);
    const h = estimateHaul({ lat: -27.5303, lng: 153.1979 }, { id: "n", name: "Narangba", lat: -27.2016, lng: 152.9621 }, settings);
    expect(h).toEqual({ km: 56.3, minutes: 56, source: "gps" });
    expect(estimateHaul({ lat: 0, lng: 0 }, { id: "x", name: "No GPS", lat: null, lng: null }, settings)).toBeNull();
  });

  it("tonnes for area and depth", () => {
    expect(tonnesFor(60, 100, 2.2)).toBe(13.2);
  });
});
