import { describe, expect, it } from "vitest";
import { alignToPlant, priceSiteQuote, type CostItem, type PricingSettings, type SiteScope, type SupplyPlant } from "@/lib/site/price";
import { haulFor } from "@/lib/site/load";
import { buildSiteSystemPrompt, cleanScope } from "@/lib/site/scope-ai";
import { buildPriceListMessages, cleanPriceList, matchToLibrary, readPriceList } from "@/lib/site/price-list";

const base = { density_t_per_m3: 2.4, includes_delivery: false, truck_capacity_t: null, active: true } as const;
/** Made-up demo prices: the same mix costs a bit more at Brendale. */
const lib: CostItem[] = [
  { ...base, id: "ac10-n", category: "material", material_kind: "asphalt", name: "AC10 asphalt", unit: "t", rate: 150, supply_plant_id: "narangba" },
  { ...base, id: "ac10-b", category: "material", material_kind: "asphalt", name: "AC10 Asphalt", unit: "t", rate: 156, supply_plant_id: "brendale" },
  { ...base, id: "ac14-n", category: "material", material_kind: "asphalt", name: "AC14 asphalt", unit: "t", rate: 140, supply_plant_id: "narangba" },
  { ...base, id: "prime", category: "material", material_kind: "prime", name: "Prime", unit: "m2", rate: 1.8, density_t_per_m3: null, supply_plant_id: null },
  { ...base, id: "truck", category: "truck", material_kind: null, name: "Truck", unit: "h", rate: 140, density_t_per_m3: null, truck_capacity_t: 12 },
];
const plants: SupplyPlant[] = [
  { id: "narangba", name: "Narangba plant", lat: -27.2016, lng: 152.9621 },
  { id: "brendale", name: "Brendale quarry", lat: -27.324, lng: 152.983 },
];
const settings: PricingSettings = { truck_load_minutes: 15, truck_unload_minutes: 10, shift_minutes: 480, road_factor: 1.3, average_speed_kmh: 60, gst_percent: 10 };
const scope = (): SiteScope => ({
  title: "Carpark", job_type: "carpark",
  items: [
    { key: "i1", kind: "asphalt", description: "AC10, 40 mm", area_m2: 1000, depth_mm: 40, cost_item_id: "ac10-n", quantity: null },
    { key: "i2", kind: "asphalt", description: "AC14, 50 mm", area_m2: 100, depth_mm: 50, cost_item_id: "ac14-n", quantity: null },
    { key: "i3", kind: "prime", description: "Prime", area_m2: 1000, depth_mm: null, cost_item_id: "prime", quantity: null },
  ],
  crew: [], plant: [], supply_plant_id: "narangba", truck_cost_item_id: "truck", assumptions: [], questions: [],
});

describe("mix prices per plant", () => {
  it("swaps each mix for the same mix at the new plant, leaving general costs alone", () => {
    const s = alignToPlant(scope(), lib, "brendale");
    expect(s.supply_plant_id).toBe("brendale");
    expect(s.items.map((i) => i.cost_item_id)).toEqual(["ac10-b", "ac14-n", "prime"]); // no AC14 at Brendale: kept, flagged below
    const p = priceSiteQuote({ scope: s, library: lib, settings, haul: { km: 20, minutes: 25, source: "road" }, marginPercent: 15 });
    expect(p.warnings).toContain("AC14 asphalt is priced at a different plant from the one chosen for this job.");
    expect(p.costLines.find((l) => l.key === "i1")?.cost).toBe(96 * 156);
  });

  it("no warning when mixes match the plant", () => {
    const p = priceSiteQuote({ scope: scope(), library: lib, settings, haul: { km: 20, minutes: 25, source: "road" }, marginPercent: 15 });
    expect(p.warnings.filter((w) => w.includes("different plant"))).toEqual([]);
  });

  it("tells the AI which plant each mix belongs to, and infers the plant from the mixes", () => {
    const prompt = buildSiteSystemPrompt("Demo Asphalt Co", lib, plants);
    expect(prompt).toContain("AC10 Asphalt | per t | 2.4 t/m3 | from Brendale quarry only");
    expect(prompt).not.toContain("156"); // never shows rates
    const { scope: s } = cleanScope({ ...scope(), supply_plant_id: null, items: [{ ...scope().items[0], cost_item_id: "ac10-b" }] }, lib, plants);
    expect(s.supply_plant_id).toBe("brendale");
  });

  it("when the AI picks one plant but another plant's mix, the mix is swapped to match", () => {
    const { scope: s } = cleanScope({ ...scope(), supply_plant_id: "brendale" }, lib, plants);
    expect(s.items[0].cost_item_id).toBe("ac10-b");
  });
});

describe("haul from road routes", () => {
  const site = { lat: -27.5, lng: 153.1 };
  const routes = { narangba: { km: 44.2, minutes: 46, source: "google" as const } };
  it("uses the road route for the chosen plant", () => {
    expect(haulFor(scope(), site, plants, settings, routes)).toEqual({ km: 44.2, minutes: 46, source: "road" });
  });
  it("falls back to the straight-line estimate for a plant with no route", () => {
    expect(haulFor({ ...scope(), supply_plant_id: "brendale" }, site, plants, settings, routes)?.source).toBe("gps");
  });
  it("the user's own figures still win", () => {
    expect(haulFor({ ...scope(), haul_override: { km: 50, minutes: 55 } }, site, plants, settings, routes)).toEqual({ km: 50, minutes: 55, source: "entered" });
  });
});

describe("reading a price list", () => {
  it("keeps printed prices only, drops junk and duplicates, flags GST-inclusive lists", () => {
    const r = cleanPriceList({
      supplier: "Demo Quarries", valid_until: "2027-06-30", gst: "included",
      lines: [
        { name: " AC10  C320 ", unit: "t", rate: 171.6, kind: "asphalt", notes: "ex plant" },
        { name: "AC10 C320", unit: "t", rate: 170, kind: "asphalt", notes: null },
        { name: "Mystery", unit: "t", rate: 0, kind: "asphalt", notes: null },
        { name: "Bad unit", unit: "bag", rate: 12, kind: "weird", notes: null },
      ],
      warnings: ["Small load fee under 10 t"],
    });
    expect(r.lines).toEqual([
      { name: "AC10 C320", unit: "t", rate: 171.6, kind: "asphalt", notes: "ex plant" },
      { name: "Bad unit", unit: "other", rate: 12, kind: "other", notes: null },
    ]);
    expect(r.warnings[0]).toMatch(/include GST/);
    expect(r.warnings).toContain('"AC10 C320" was listed twice; kept the first price.');
    expect(r.valid_until).toBe("2027-06-30");
  });

  it("sends PDF text or images, with the contractor's names to reuse", async () => {
    const msgs = buildPriceListMessages({ plantName: "Brendale quarry", text: null, imageUrls: ["https://x/1.png"], existingNames: ["AC10 asphalt"] });
    expect(String(msgs[0].content)).toContain("AC10 asphalt");
    expect(msgs[1].content).toEqual([{ type: "text", text: "The price list is in the attached image(s)." }, { type: "image_url", image_url: { url: "https://x/1.png" } }]);
    const read = await readPriceList(async () => ({ provider: "fake", model: "m", latency_ms: 1, usage: { input_tokens: 1, output_tokens: 1 } as never, json: { supplier: null, valid_until: null, gst: "excluded", lines: [{ name: "AC10 asphalt", unit: "t", rate: 158, kind: "asphalt", notes: null }], warnings: [] } }),
      { plantName: "Brendale quarry", text: "AC10 $158/t", imageUrls: [], existingNames: [] });
    expect(matchToLibrary(read.lines, lib, "brendale")).toEqual(["ac10-b"]);
    expect(matchToLibrary(read.lines, lib, "narangba")).toEqual(["ac10-n"]);
    await expect(readPriceList(async () => { throw new Error("no"); }, { plantName: "x", text: " ", imageUrls: [], existingNames: [] })).rejects.toThrow("Nothing to read");
  });
});
