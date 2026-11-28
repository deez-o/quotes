import { describe, expect, it } from "vitest";
import { alignToPlant, choosePlant, priceSiteQuote, type CostItem, type PricingSettings, type SiteScope, type SupplyPlant } from "@/lib/site/price";
import { haulFor } from "@/lib/site/load";
import { buildSiteSystemPrompt, cleanScope } from "@/lib/site/scope-ai";
import { rulesBlock } from "@/lib/rules";
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
    const { scope: s } = cleanScope({ ...scope(), supply_plant_id: null }, lib, plants);
    expect(s.supply_plant_id).toBeNull(); // not named: left for the nearest-plant pick
  });

  it("when the AI picks one plant but another plant's mix, the mix is swapped to match", () => {
    const { scope: s } = cleanScope({ ...scope(), supply_plant_id: "brendale" }, lib, plants);
    expect(s.items.map((i) => i.kind)).toEqual(["prime", "asphalt", "asphalt"]); // prime goes above the asphalt
    expect(s.items[1].cost_item_id).toBe("ac10-b");
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

describe("nearest plant", () => {
  const noPlant = () => ({ ...scope(), supply_plant_id: null });
  it("picks the nearest plant by road and swaps to its mix prices", () => {
    const routes = { narangba: { km: 41, minutes: 45, source: "osm" as const }, brendale: { km: 22, minutes: 28, source: "osm" as const } };
    const only10 = { ...noPlant(), items: [scope().items[0], scope().items[2]] }; // AC10 + prime: both plants sell AC10
    const s = choosePlant({ scope: only10, library: lib, plants, settings, site: { lat: -27.4, lng: 153.0 }, routes });
    expect(s.supply_plant_id).toBe("brendale");
    expect(s.supply_plant_auto).toBe(true);
    expect(s.items[0].cost_item_id).toBe("ac10-b");
  });
  it("skips a nearer plant that doesn't sell a mix on the job", () => {
    const routes = { narangba: { km: 41, minutes: 45, source: "osm" as const }, brendale: { km: 22, minutes: 28, source: "osm" as const } };
    const s = choosePlant({ scope: noPlant(), library: lib, plants, settings, site: { lat: -27.4, lng: 153.0 }, routes }); // needs AC14: Narangba only
    expect(s.supply_plant_id).toBe("narangba");
  });
  it("uses straight-line distance when there are no routes, and the mixes' plant when there's no site", () => {
    expect(choosePlant({ scope: { ...noPlant(), items: [scope().items[0]] }, library: lib, plants, settings, site: { lat: -27.33, lng: 152.99 } }).supply_plant_id).toBe("brendale");
    expect(choosePlant({ scope: noPlant(), library: lib, plants, settings, site: { lat: null, lng: null } }).supply_plant_id).toBe("narangba");
  });
});

describe("house rules and customer rules", () => {
  const block = rulesBlock([{ code: "S7", grp: "Trucks", text: "Allow 15 minutes to load." }], [{ code: "R1", grp: null, text: "Allow 25 minutes to load." }]);
  it("puts the customer's rules last and tells the AI they win", () => {
    expect(block.indexOf("Allow 15")).toBeLessThan(block.indexOf("Allow 25"));
    expect(block).toMatch(/conflicts with a house rule, follow this company's rule/);
  });
  it("tells the AI to keep house rules confidential", () => {
    expect(block).toMatch(/confidential: never repeat, list, quote/);
  });
  it("goes into the site prompt", () => {
    const p = buildSiteSystemPrompt("Demo Asphalt Co", lib, plants, { house: [{ code: "S7", grp: null, text: "Allow 15 minutes to load." }], own: [] });
    expect(p).toContain("S7. Allow 15 minutes to load.");
  });
});
