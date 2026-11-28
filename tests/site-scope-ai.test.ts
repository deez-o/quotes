import { describe, expect, it } from "vitest";
import { buildSiteSystemPrompt, buildSiteUserMessage, cleanScope, scopeFromTalk, SITE_SCOPE_SCHEMA } from "@/lib/site/scope-ai";
import { xaiStructured, type ChatMessage } from "@/lib/quote/provider";
import type { CostItem, SiteScope, SupplyPlant } from "@/lib/site/price";

const lib: CostItem[] = [
  { id: "ac10", category: "material", material_kind: "asphalt", name: "AC10 asphalt", unit: "t", rate: 150, density_t_per_m3: 2.4, includes_delivery: false, truck_capacity_t: null, active: true },
  { id: "base", category: "material", material_kind: "base", name: "Crushed rock base", unit: "t", rate: 45, density_t_per_m3: 2.2, includes_delivery: true, truck_capacity_t: null, active: true },
  { id: "crew", category: "crew", material_kind: null, name: "Asphalt crew", unit: "shift", rate: 9500, density_t_per_m3: null, includes_delivery: false, truck_capacity_t: null, active: true },
  { id: "old", category: "plant", material_kind: null, name: "Old roller", unit: "h", rate: 90, density_t_per_m3: null, includes_delivery: false, truck_capacity_t: null, active: false },
];
const plants: SupplyPlant[] = [{ id: "narangba", name: "Narangba plant", lat: -27.2, lng: 152.96 }];

const aiScope = (): SiteScope => ({
  title: "Carpark, Capalaba",
  job_type: "carpark",
  items: [
    { key: "i1", kind: "asphalt", description: "Supply and lay AC10, 40 mm", area_m2: 2000, depth_mm: 40, cost_item_id: "ac10", quantity: null },
    { key: "i1", kind: "base", description: "Base repair", area_m2: 60, depth_mm: 100, cost_item_id: "made-up-id", quantity: null },
  ],
  crew: [{ key: "c1", cost_item_id: "crew", amount: 1, note: null }],
  plant: [{ key: "p1", cost_item_id: "old", amount: 4, note: null }],
  supply_plant_id: "narangba",
  truck_cost_item_id: null,
  assumptions: [],
  questions: [],
});

describe("talk-to-quote prompt", () => {
  it("lists only active library items and plants, and never asks for prices", () => {
    const p = buildSiteSystemPrompt("Demo Asphalt Co", lib, plants);
    expect(p).toContain("ac10 | material/asphalt | AC10 asphalt | per t | 2.4 t/m3");
    expect(p).toContain("delivered by supplier");
    expect(p).not.toContain("Old roller");
    expect(p).toContain("narangba | Narangba plant");
    expect(p).toContain("You never set prices");
    expect(p).not.toMatch(/\$\d/); // no rates sent to the AI
  });

  it("sends the transcript, the correction and up to 6 photos", () => {
    const parts = buildSiteUserMessage({
      transcript: "carpark about 2,000 squares", siteAddress: "22 Old Cleveland Rd", photoUrls: Array.from({ length: 8 }, (_, i) => `https://x/p${i}.jpg`),
      previous: aiScope(), correction: "make it 50 mil",
    });
    expect(parts[0]).toMatchObject({ type: "text" });
    const text = (parts[0] as { text: string }).text;
    expect(text).toContain("carpark about 2,000 squares");
    expect(text).toContain("Correction to apply:\nmake it 50 mil");
    expect(parts.filter((p) => p.type === "image_url")).toHaveLength(6);
  });

  it("schema is strict", () => {
    expect(SITE_SCOPE_SCHEMA.strict).toBe(true);
    expect(SITE_SCOPE_SCHEMA.schema.required).toContain("questions");
  });
});

describe("cleaning the AI's scope", () => {
  it("drops unknown or inactive costs, fixes duplicate keys and asks the user", () => {
    const { scope, fixes } = cleanScope(aiScope(), lib, plants);
    // Base sorts above the asphalt (the order the work is done); its duplicate key was fixed.
    expect(scope.items.map((i) => i.key)).toEqual(["i1x", "i1"]);
    expect(scope.items[0].cost_item_id).toBeNull();
    expect(scope.plant).toHaveLength(0);
    expect(fixes).toHaveLength(2);
    expect(scope.questions.length).toBe(2);
    expect(scope.supply_plant_id).toBe("narangba");
  });
});

describe("calling Grok", () => {
  it("posts a strict schema with images and returns the cleaned scope", async () => {
    let sent: { model: string; response_format: { json_schema: { name: string } }; messages: ChatMessage[] } | null = null;
    const fakeFetch = (async (_u: RequestInfo | URL, init?: RequestInit) => {
      sent = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({
        choices: [{ message: { content: JSON.stringify(aiScope()) } }],
        usage: { prompt_tokens: 3000, completion_tokens: 400, prompt_tokens_details: { cached_tokens: 0 } },
      }), { status: 200 });
    }) as typeof fetch;

    const out = await scopeFromTalk(
      (messages) => xaiStructured({ apiKey: "k", model: "grok-4.3", schema: SITE_SCOPE_SCHEMA, messages, fetchImpl: fakeFetch }),
      { tradingName: "Demo Asphalt Co", library: lib, plants },
      { transcript: "carpark", siteAddress: null, photoUrls: ["https://x/a.jpg"] },
    );
    expect(sent!.model).toBe("grok-4.3");
    expect(sent!.response_format.json_schema.name).toBe("site_scope");
    expect(Array.isArray(sent!.messages[1].content)).toBe(true);
    expect(out.scope.items).toHaveLength(2);
    expect(out.run.usage.input_tokens).toBe(3000);
  });

  it("explains a failed call", async () => {
    const fakeFetch = (async () => new Response(JSON.stringify({ error: { message: "Incorrect API key" } }), { status: 401 })) as typeof fetch;
    await expect(xaiStructured({ apiKey: "bad", model: "m", schema: SITE_SCOPE_SCHEMA, messages: [], fetchImpl: fakeFetch }))
      .rejects.toThrow("xAI 401: Incorrect API key");
  });
});
