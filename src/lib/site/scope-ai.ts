/**
 * Talk-to-quote: what the contractor said on site (plus photos) -> a scope.
 * The AI only describes the job and picks items from the customer's own costs
 * library by id. It never prices anything: price.ts does the maths.
 */
import type { ChatMessage, ChatPart, ProviderResult } from "@/lib/quote/provider";
import { alignToPlant, type CostItem, type SiteScope, type SupplyPlant } from "./price";
import { rulesBlock, type LayeredRule } from "@/lib/rules";

export const SITE_PROMPT_VERSION = "site-v1";

const nullableNumber = { type: ["number", "null"] } as const;
const nullableString = { type: ["string", "null"] } as const;
const line = {
  type: "object", additionalProperties: false, required: ["key", "cost_item_id", "amount", "note"],
  properties: { key: { type: "string" }, cost_item_id: { type: "string" }, amount: { type: "number" }, note: nullableString },
} as const;

export const SITE_SCOPE_SCHEMA = {
  name: "site_scope",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["title", "job_type", "items", "crew", "plant", "supply_plant_id", "truck_cost_item_id", "assumptions", "questions"],
    properties: {
      title: { type: "string" },
      job_type: { type: "string", enum: ["carpark", "driveway", "road", "subdivision", "patching", "spray_seal", "other"] },
      items: {
        type: "array",
        items: {
          type: "object", additionalProperties: false,
          required: ["key", "kind", "description", "area_m2", "depth_mm", "cost_item_id", "quantity"],
          properties: {
            key: { type: "string" },
            kind: { type: "string", enum: ["asphalt", "base", "prime", "seal", "excavation", "other"] },
            description: { type: "string" },
            area_m2: nullableNumber,
            depth_mm: nullableNumber,
            cost_item_id: nullableString,
            quantity: nullableNumber,
          },
        },
      },
      crew: { type: "array", items: line },
      plant: { type: "array", items: line },
      supply_plant_id: nullableString,
      truck_cost_item_id: nullableString,
      assumptions: { type: "array", items: { type: "string" } },
      questions: { type: "array", items: { type: "string" } },
    },
  },
} as const;

export function buildSiteSystemPrompt(tradingName: string, library: CostItem[], plants: SupplyPlant[], rules?: { house: LayeredRule[]; own: LayeredRule[] }): string {
  const active = library.filter((c) => c.active);
  const plantName = new Map(plants.map((p) => [p.id, p.name]));
  const libLines = active.map((c) =>
    `${c.id} | ${c.category}${c.material_kind ? `/${c.material_kind}` : ""} | ${c.name} | per ${c.unit}${c.density_t_per_m3 ? ` | ${c.density_t_per_m3} t/m3` : ""}${c.includes_delivery ? " | delivered by supplier" : ""}${c.supply_plant_id ? ` | from ${plantName.get(c.supply_plant_id) ?? "a plant"} only` : ""}`,
  );
  const plantLines = plants.map((p) => `${p.id} | ${p.name}`);
  return [
    `# Role`,
    `You help ${tradingName}, a paving contractor, quote a job from what they say on site and from their photos. You turn it into a scope a person will check. You never set prices, rates or totals: code prices the scope from their costs library.`,
    ``,
    `# Rules`,
    `1. Only use cost_item_id values from the library below. If nothing fits, set cost_item_id to null and add a question.`,
    `2. Quantities only from what was said or clearly visible: area in m2, depth in mm. Convert units (e.g. "100 mil" = 100 mm, "2,000 squares" = 2000 m2, "half a day" = 4 h if shifts are 8 h). Never invent a number: if a needed quantity is missing, leave it null and ask.`,
    `3. Asphalt and base items need area_m2 and depth_mm. Prime and seal need area_m2. "other" items use quantity in the cost item's unit.`,
    `4. Crew lines: amount is shifts (or days or hours, per the cost item's unit). Plant lines: amount in the cost item's unit, usually hours.`,
    `5. Prime under new asphalt on a new base is normal practice: add it and say so in assumptions if it wasn't mentioned.`,
    `6. supply_plant_id: only if they name a plant (match it to the list). Otherwise null: the app picks the nearest plant to the site.`,
    `6a. Mixes marked "from <plant> only" are that plant's prices. Pick the right mix by name from any plant; the app swaps it to the chosen plant's price.`,
    `7. truck_cost_item_id: the truck item from the library if any material must be carted (not delivered by the supplier).`,
    `8. Use short, clear descriptions a customer would understand ("Supply and lay AC10, 40 mm").`,
    `9. Every assumption you make goes in assumptions. Anything you need to know goes in questions, briefly.`,
    `10. If a previous scope is given, apply the correction to it and keep everything else unchanged, including keys.`,
    ``,
    ...(rules && (rules.house.length || rules.own.length)
      ? [`# How this company quotes (apply what's relevant to this job; rules 1-10 above still hold: you never price)`, rulesBlock(rules.house, rules.own), ``]
      : []),
    `# Costs library (id | type | name | unit | notes)`,
    libLines.join("\n") || "Empty: ask the user to add their costs first.",
    ``,
    `# Supply plants (id | name)`,
    plantLines.join("\n") || "None.",
    ``,
    `Reply with JSON only, matching schema site_scope.`,
  ].join("\n");
}

export function buildSiteUserMessage(input: {
  transcript: string;
  siteAddress: string | null;
  photoUrls: string[];
  previous?: SiteScope | null;
  correction?: string | null;
}): ChatPart[] {
  const text = [
    input.siteAddress ? `Site: ${input.siteAddress}` : "Site address not given.",
    ``,
    `What they said:`,
    input.transcript.trim() || "(nothing said)",
    ...(input.previous ? [``, `Previous scope (JSON):`, JSON.stringify(input.previous)] : []),
    ...(input.correction ? [``, `Correction to apply:`, input.correction.trim()] : []),
    ``,
    input.photoUrls.length ? `${input.photoUrls.length} site photo(s) attached.` : "No photos.",
  ].join("\n");
  return [{ type: "text", text }, ...input.photoUrls.slice(0, 6).map((url) => ({ type: "image_url" as const, image_url: { url } }))];
}

/** Keep only ids that exist; make keys unique; drop negatives. Returns notes for anything fixed. */
export function cleanScope(raw: SiteScope, library: CostItem[], plants: SupplyPlant[]): { scope: SiteScope; fixes: string[] } {
  const ids = new Set(library.filter((c) => c.active).map((c) => c.id));
  const fixes: string[] = [];
  const seen = new Set<string>();
  const uniqueKey = (k: string, prefix: string) => {
    let key = (k || prefix).replace(/[^\w-]/g, "").slice(0, 24) || prefix;
    while (seen.has(key)) key = `${key}x`;
    seen.add(key);
    return key;
  };
  const pos = (n: number | null) => (n == null || !Number.isFinite(n) || n < 0 ? null : n);

  const items = raw.items.map((i, n) => {
    let cost = i.cost_item_id;
    if (cost && !ids.has(cost)) {
      fixes.push(`"${i.description}" pointed at a cost that isn't in your library.`);
      cost = null;
    }
    return { ...i, key: uniqueKey(i.key, `i${n + 1}`), cost_item_id: cost, area_m2: pos(i.area_m2), depth_mm: pos(i.depth_mm), quantity: pos(i.quantity) };
  });
  const lines = (arr: SiteScope["crew"], prefix: string) =>
    arr.filter((l) => {
      const ok = ids.has(l.cost_item_id) && Number.isFinite(l.amount) && l.amount >= 0;
      if (!ok) fixes.push(`A ${prefix === "c" ? "crew" : "plant"} line pointed at a cost that isn't in your library.`);
      return ok;
    }).map((l, n) => ({ ...l, key: uniqueKey(l.key, `${prefix}${n + 1}`) }));

  const plantOk = raw.supply_plant_id && plants.some((p) => p.id === raw.supply_plant_id) ? raw.supply_plant_id : null;
  const truckOk = raw.truck_cost_item_id && ids.has(raw.truck_cost_item_id) ? raw.truck_cost_item_id : null;
  // A named plant: swap the mixes to its prices. No plant: left for choosePlant (nearest to the site).
  const plantId = plantOk;
  const aligned = plantId ? alignToPlant({ ...raw, items }, library, plantId).items : items;

  return {
    scope: {
      ...raw,
      items: aligned,
      crew: lines(raw.crew, "c"),
      plant: lines(raw.plant, "p"),
      supply_plant_id: plantId,
      truck_cost_item_id: truckOk,
      questions: [...raw.questions, ...fixes.map((f) => `${f} Pick the right one.`)],
    },
    fixes,
  };
}

export function looksLikeScope(json: unknown): json is SiteScope {
  if (!json || typeof json !== "object") return false;
  const o = json as Record<string, unknown>;
  return Array.isArray(o.items) && Array.isArray(o.crew) && Array.isArray(o.plant) && typeof o.title === "string";
}

export type ScopeCall = (messages: ChatMessage[]) => Promise<ProviderResult>;

/** Ask the AI for a scope (or a corrected scope), then clean it against the library. */
export async function scopeFromTalk(
  call: ScopeCall,
  ctx: { tradingName: string; library: CostItem[]; plants: SupplyPlant[]; rules?: { house: LayeredRule[]; own: LayeredRule[] } },
  input: Parameters<typeof buildSiteUserMessage>[0],
): Promise<{ scope: SiteScope; run: ProviderResult; fixes: string[] }> {
  const messages: ChatMessage[] = [
    { role: "system", content: buildSiteSystemPrompt(ctx.tradingName, ctx.library, ctx.plants, ctx.rules) },
    { role: "user", content: buildSiteUserMessage(input) },
  ];
  const run = await call(messages);
  if (!looksLikeScope(run.json)) throw new Error("The AI's answer wasn't a usable scope. Try again.");
  const { scope, fixes } = cleanScope(run.json, ctx.library, ctx.plants);
  return { scope, run, fixes };
}
