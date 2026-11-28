import { describe, expect, it } from "vitest";
import { overtimeDay, priceSiteQuote, type CostItem, type PricingSettings, type SiteScope } from "@/lib/site/price";
import { buildSiteSystemPrompt, cleanScope } from "@/lib/site/scope-ai";

/** Made-up demo figures: $9,500 a shift split over 8 hours. */
const crew: CostItem = { id: "crew", category: "crew", material_kind: null, name: "Asphalt crew", unit: "h", rate: 1187.5, density_t_per_m3: null, includes_delivery: false, truck_capacity_t: null, active: true, ordinary_hours: 8, ot1_hours: 2, ot1_multiplier: 1.5, ot2_multiplier: 2 };
const bobcat: CostItem = { id: "bobcat", category: "plant", material_kind: null, name: "Bobcat", unit: "h", rate: 120, density_t_per_m3: null, includes_delivery: false, truck_capacity_t: null, active: true };
const settings: PricingSettings = { truck_load_minutes: 15, truck_unload_minutes: 10, shift_minutes: 480, road_factor: 1.3, average_speed_kmh: 60, gst_percent: 10 };
const scope = (hours: number, days: number | null = null): SiteScope => ({
  title: "Job", job_type: "carpark", items: [], plant: [{ key: "p1", cost_item_id: "bobcat", amount: 4, days: 2, note: null }],
  crew: [{ key: "c1", cost_item_id: "crew", amount: hours, days, note: null }],
  supply_plant_id: null, truck_cost_item_id: null, assumptions: [], questions: [],
});

describe("crew by the hour with overtime", () => {
  it("8 hours is the ordinary rate", () => {
    expect(overtimeDay(crew, 8).cost).toBe(9500);
  });
  it("10 hours: 2 hours at time and a half", () => {
    expect(overtimeDay(crew, 10).cost).toBe(9500 + 2 * 1781.25);
  });
  it("12 hours: then double time", () => {
    expect(overtimeDay(crew, 12).cost).toBe(9500 + 2 * 1781.25 + 2 * 2375);
  });
  it("prices days, shows the working, and counts shifts by days", () => {
    const p = priceSiteQuote({ scope: scope(10, 2), library: [crew, bobcat], settings, haul: null, marginPercent: 15 });
    const line = p.costLines.find((l) => l.key === "c1")!;
    expect(line.cost).toBe(2 * (9500 + 3562.5));
    expect(line.working).toBe("2 days × (8 h × $1,187.50 + 2 h × $1,781.25) (overtime after 8 h)");
    expect(p.costLines.find((l) => l.key === "p1")?.cost).toBe(960); // bobcat 4 h a day × 2 days, no overtime set
    expect(p.shifts).toBe(2);
  });
  it("missing hours: not priced, and asks", () => {
    const p = priceSiteQuote({ scope: scope(0), library: [crew, bobcat], settings, haul: null, marginPercent: 15 });
    expect(p.costLines.find((l) => l.key === "c1")).toBeUndefined();
    expect(p.warnings).toContain("Asphalt crew: how many hours a day?");
  });
});

describe("the AI asks for what's missing", () => {
  it("gives a crew line with unknown hours a 10-hour day", () => {
    const raw = { ...scope(0), crew: [{ key: "c1", cost_item_id: "crew", amount: null as unknown as number, days: null, note: null }] };
    const { scope: s } = cleanScope(raw, [crew, bobcat], []);
    expect(s.crew[0]).toMatchObject({ amount: crew.unit === "h" ? 10 : 1, days: null });
  });
  it("tells the AI to assume a 10-hour day and ask for the job's location", () => {
    const p = buildSiteSystemPrompt("Demo", [crew], []);
    expect(p).toMatch(/If the hours a day aren't said, use 10 hours a day/);
    expect(p).toMatch(/site_location: the job's address or suburb if they say it/);
  });
});

describe("float charge", () => {
  const float: CostItem = { id: "float", category: "float", material_kind: null, name: "Float", unit: "each", rate: 650, density_t_per_m3: null, includes_delivery: false, truck_capacity_t: null, active: true };
  const ac10: CostItem = { id: "ac10", category: "material", material_kind: "asphalt", name: "AC10", unit: "t", rate: 150, density_t_per_m3: 2.4, includes_delivery: true, truck_capacity_t: null, active: true };
  const withAsphalt = (moves?: number | null): SiteScope => ({
    ...scope(8), plant: [], float_moves: moves ?? null,
    items: [{ key: "i1", kind: "asphalt", description: "AC10, 40 mm", area_m2: 500, depth_mm: 40, cost_item_id: "ac10", quantity: null }],
  });
  it("adds one float move to an asphalt job as a cost, built into the asphalt line", () => {
    const p = priceSiteQuote({ scope: withAsphalt(), library: [crew, ac10, float], settings, haul: null, marginPercent: 15 });
    expect(p.costLines.find((l) => l.key === "float")).toMatchObject({ cost: 650, working: "1 move × $650 (one per asphalt job)" });
    expect(p.customerLines.map((l) => l.key)).toEqual(["i1"]); // no float line for the customer
    expect(p.customerLines[0].total).toBe(p.priceExGst);
  });
  it("uses the moves entered, and none for a spray-only job", () => {
    expect(priceSiteQuote({ scope: withAsphalt(2), library: [crew, ac10, float], settings, haul: null, marginPercent: 15 }).costLines.find((l) => l.key === "float")?.cost).toBe(1300);
    expect(priceSiteQuote({ scope: { ...withAsphalt(), items: [] }, library: [crew, float], settings, haul: null, marginPercent: 15 }).costLines.find((l) => l.key === "float")).toBeUndefined();
  });
});

describe("sliding-scale rates", () => {
  const seal: CostItem = { id: "seal", category: "material", material_kind: "seal", name: "Two coat seal", unit: "m2", rate: 5.5, density_t_per_m3: null, includes_delivery: false, truck_capacity_t: null, active: true,
    rate_tiers: [{ up_to: 2000, rate: 7.2 }, { up_to: 500, rate: 9.5 }] };
  const job = (m2: number): SiteScope => ({ ...scope(8), crew: [], plant: [], items: [{ key: "s1", kind: "seal", description: "Seal", area_m2: m2, depth_mm: null, cost_item_id: "seal", quantity: null }] });
  const line = (m2: number) => priceSiteQuote({ scope: job(m2), library: [seal], settings, haul: null, marginPercent: 0 }).costLines[0];
  it("small jobs get the small-job rate", () => {
    expect(line(300)).toMatchObject({ cost: 2850, working: "300 m² × $9.50/m² (0–500 m² rate)" });
  });
  it("the whole job is priced at its band's rate", () => {
    expect(line(1800)).toMatchObject({ cost: 12960, working: "1,800 m² × $7.20/m² (500–2,000 m² rate)" });
  });
  it("above the last break, the normal rate", () => {
    expect(line(5000)).toMatchObject({ cost: 27500, working: "5,000 m² × $5.50/m² (over 2,000 m² rate)" });
  });
});

import { DEFAULT_TERMS, renderTerms } from "@/lib/site/terms";
describe("quote terms", () => {
  it("default terms carry rise and fall and the bitumen month the quote was done", () => {
    expect(DEFAULT_TERMS).toMatch(/subject to rise and fall/);
    expect(renderTerms(null, "2026-11-27T05:00:00Z")).toContain("index for November 2026");
    expect(renderTerms("Our terms, bitumen {bitumen_month}.", "2026-12-31T20:00:00Z")).toBe("Our terms, bitumen January 2027."); // Brisbane time
  });
});
