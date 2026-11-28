import { describe, expect, it } from "vitest";
import { binderExtraFor, binderInName, normaliseBinder } from "@/lib/binder";
import { cleanPriceList } from "@/lib/site/price-list";
import { priceSiteQuote, type CostItem, type SiteScope } from "@/lib/site/price";

describe("binder names", () => {
  it.each([
    ["Class 320", "C320"], ["C600 bitumen", "C600"], ["cl. 450", "C450"], ["Multigrade", "M1000"], ["M1000 multigrade", "M1000"],
    ["PMB A15E", "A15E"], ["SBS A 15 E", "A15E"], ["MG", "M1000"], ["AC14 MG", "M1000"], ["crumb rubber", "CRUMB"], ["Rubberised", "CRUMB"], ["EME2", "EME2"], ["600", "C600"],
  ])("%s -> %s", (raw, code) => expect(normaliseBinder(raw)).toBe(code));
  it("finds a binder in a mix name, or none", () => {
    expect(binderInName("AC14 A15E")).toBe("A15E");
    expect(binderInName("AC10 C320")).toBe("C320");
    expect(binderInName("AC10")).toBeNull();
    expect(binderInName("AC14 20mm")).toBeNull();
  });
});

const setup = { plantBase: { p1: "C320" }, extras: [{ supply_plant_id: "p1", binder: "C600", extra_per_t: 8 }], defaultBinder: "C320" };

describe("binder extra-over", () => {
  it("adds the extra for another binder, none for the base, flags a missing one", () => {
    expect(binderExtraFor(setup, "p1", "AC14", "C600")).toEqual({ kind: "extra", binder: "C600", extra: 8, base: "C320" });
    expect(binderExtraFor(setup, "p1", "AC14", "Class 320")).toEqual({ kind: "none" });
    expect(binderExtraFor(setup, "p1", "AC14", "A15E")).toMatchObject({ kind: "missing", binder: "A15E" });
    expect(binderExtraFor(setup, "p1", "AC14 C600", "C600")).toEqual({ kind: "none" });
  });

  const lib: CostItem[] = [
    { id: "m", category: "material", material_kind: "asphalt", name: "AC14", unit: "t", rate: 160, density_t_per_m3: 2.4, includes_delivery: true, truck_capacity_t: null, active: true, supply_plant_id: "p1" },
    { id: "b", category: "plant", material_kind: null, name: "Bobcat", unit: "h", rate: 100, density_t_per_m3: null, includes_delivery: false, truck_capacity_t: null, active: true, min_hours: 6 },
  ];
  const scope = (binder: string | null): SiteScope => ({
    title: "t", job_type: "carpark", supply_plant_id: "p1", truck_cost_item_id: null, assumptions: [], questions: [], float_moves: 0,
    items: [{ key: "i1", kind: "asphalt", description: "AC14", area_m2: 100, depth_mm: 50, cost_item_id: "m", quantity: null, binder }],
    crew: [], plant: [{ key: "p", cost_item_id: "b", amount: 2, note: null }],
  });
  const settings = { truck_load_minutes: 15, truck_unload_minutes: 10, shift_minutes: 480, road_factor: 1.3, average_speed_kmh: 60, gst_percent: 10, binders: setup };

  it("prices C600 at the plant's AC14 + $8/t", () => {
    const p = priceSiteQuote({ scope: scope("C600"), library: lib, settings, haul: null, marginPercent: 0 });
    const line = p.costLines.find((l) => l.key === "i1")!;
    expect(line.cost).toBe(12 * 168);
    expect(line.working).toContain("extra for C600");
  });
  it("charges the minimum hire on a short bobcat job", () => {
    const p = priceSiteQuote({ scope: scope(null), library: lib, settings, haul: null, marginPercent: 0 });
    const line = p.costLines.find((l) => l.key === "p")!;
    expect(line.cost).toBe(600);
    expect(line.working).toContain("6 h minimum");
  });
});

describe("price list binder extras", () => {
  it("keeps extras, tidies binder names, drops the base", () => {
    const r = cleanPriceList({ supplier: "X", valid_until: null, gst: "excluded", base_binder: "Class 320", warnings: [], lines: [{ name: "AC14", unit: "t", rate: 160, kind: "asphalt", notes: null }],
      binder_extras: [{ binder: "E/O Multigrade", extra_per_t: 12, applies_to: null, notes: null }, { binder: "C320", extra_per_t: 0, applies_to: null, notes: null }, { binder: "PMB A15E", extra_per_t: 35.5, applies_to: null, notes: null }] });
    expect(r.base_binder).toBe("C320");
    expect(r.binder_extras.map((e) => [e.binder, e.extra_per_t])).toEqual([["M1000", 12], ["A15E", 35.5]]);
  });
});

describe("MG in a mix name", () => {
  it("treats 'AC14 MG' as already Multigrade", () => expect(binderInName("AC14 MG")).toBe("M1000"));
});

describe("prime on the quote", () => {
  it("is one line over the whole area", () => {
    const lib: CostItem[] = [
      { id: "m", category: "material", material_kind: "asphalt", name: "AC14", unit: "t", rate: 160, density_t_per_m3: 2.4, includes_delivery: true, truck_capacity_t: null, active: true },
      { id: "k", category: "material", material_kind: "prime", name: "K2", unit: "m2", rate: 2, density_t_per_m3: null, includes_delivery: true, truck_capacity_t: null, active: true },
    ];
    const scope: SiteScope = {
      title: "t", job_type: "carpark", supply_plant_id: null, truck_cost_item_id: null, assumptions: [], questions: [], float_moves: 0, crew: [], plant: [],
      items: [
        { key: "a", kind: "asphalt", description: "40 mm", area_m2: 100, depth_mm: 40, cost_item_id: "m", quantity: null },
        { key: "p1", kind: "prime", description: "Prime under 40 mm asphalt", area_m2: 100, depth_mm: null, cost_item_id: "k", quantity: null },
        { key: "p2", kind: "prime", description: "Prime under 50 mm asphalt", area_m2: 50, depth_mm: null, cost_item_id: "k", quantity: null },
      ],
    };
    const p = priceSiteQuote({ scope, library: lib, settings: { truck_load_minutes: 15, truck_unload_minutes: 10, shift_minutes: 480, road_factor: 1.3, average_speed_kmh: 60, gst_percent: 10 }, haul: null, marginPercent: 10 });
    const primes = p.customerLines.filter((l) => l.unit === "m²");
    expect(primes).toHaveLength(1);
    expect(primes[0].quantity).toBe(150);
    expect(primes[0].description).toBe("Prime");
    expect(p.customerLines.reduce((s, l) => s + l.total, 0)).toBe(p.priceExGst);
  });
});

describe("crew over the whole job", () => {
  it("merges split crew lines into total days", async () => {
    const { cleanScope } = await import("@/lib/site/scope-ai");
    const lib = [{ id: "c", category: "crew", material_kind: null, name: "Crew", unit: "h", rate: 1000, density_t_per_m3: null, includes_delivery: false, truck_capacity_t: null, active: true }] as CostItem[];
    const raw = { title: "t", job_type: "carpark", items: [], plant: [], supply_plant_id: null, truck_cost_item_id: null, assumptions: [], questions: [],
      crew: [{ key: "c1", cost_item_id: "c", amount: 10, days: 4, note: null }, { key: "c2", cost_item_id: "c", amount: 10, days: 2, note: null }] } as unknown as SiteScope;
    const { scope } = cleanScope(raw, lib, []);
    expect(scope.crew).toHaveLength(1);
    expect(scope.crew[0].days).toBe(6);
  });
});

describe("interstate binders", () => {
  it("keeps AR450 as written so it's flagged, not read as C450", () => {
    expect(normaliseBinder("AR450")).toBe("AR450");
    expect(normaliseBinder("AR 450 binder")).toBe("AR450");
  });
  it("prices it at the default and flags it", async () => {
    const { cleanScope } = await import("@/lib/site/scope-ai");
    const lib = [{ id: "m", category: "material", material_kind: "asphalt", name: "AC14", unit: "t", rate: 160, density_t_per_m3: 2.4, includes_delivery: true, truck_capacity_t: null, active: true }] as CostItem[];
    const raw = { title: "t", job_type: "road", crew: [], plant: [], supply_plant_id: null, truck_cost_item_id: null, assumptions: [], questions: [],
      items: [{ key: "a", kind: "asphalt", description: "AC14 AR450", area_m2: 100, depth_mm: 50, cost_item_id: "m", quantity: null, binder: "AR450" }] } as unknown as SiteScope;
    const { scope } = cleanScope(raw, lib, []);
    expect(scope.items[0].binder).toBeNull();
    expect(scope.questions.join(" ")).toContain("AR450");
  });
});
