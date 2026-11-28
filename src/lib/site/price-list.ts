/**
 * Reading a supplier's price list (PDF, photo or phone screenshot) into rows the user checks
 * before anything is saved. The AI only copies prices that are printed; it never works one out.
 */
import type { ChatMessage, ChatPart, ProviderResult } from "@/lib/quote/provider";
import type { CostItem } from "./price";
import { normaliseBinder } from "@/lib/binder";

export type PriceListLine = {
  name: string;
  /** As printed, mapped to our units where it's clear. */
  unit: "t" | "m2" | "m3" | "each" | "h" | "day" | "km" | "other";
  rate: number;
  kind: "asphalt" | "base" | "prime" | "tack" | "seal" | "other";
  notes: string | null;
};

/** "Extra over" for a binder: added to every asphalt mix's $/t when the job asks for that binder. */
export type BinderExtraLine = { binder: string; extra_per_t: number; applies_to: string | null; notes: string | null };

export type PriceListRead = {
  supplier: string | null;
  valid_until: string | null; // YYYY-MM-DD
  gst: "excluded" | "included" | "unknown";
  lines: PriceListLine[];
  /** The binder the mix prices are based on, if the list says (e.g. "prices based on C320"). */
  base_binder: string | null;
  binder_extras: BinderExtraLine[];
  warnings: string[];
};

export const PRICE_LIST_SCHEMA = {
  name: "price_list",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["supplier", "valid_until", "gst", "lines", "base_binder", "binder_extras", "warnings"],
    properties: {
      supplier: { type: ["string", "null"] },
      valid_until: { type: ["string", "null"], description: "YYYY-MM-DD if printed" },
      gst: { type: "string", enum: ["excluded", "included", "unknown"] },
      lines: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["name", "unit", "rate", "kind", "notes"],
          properties: {
            name: { type: "string" },
            unit: { type: "string", enum: ["t", "m2", "m3", "each", "h", "day", "km", "other"] },
            rate: { type: "number" },
            kind: { type: "string", enum: ["asphalt", "base", "prime", "tack", "seal", "other"] },
            notes: { type: ["string", "null"] },
          },
        },
      },
      base_binder: { type: ["string", "null"], description: "The binder the mix prices include, if stated or obvious (usually C320)." },
      binder_extras: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["binder", "extra_per_t", "applies_to", "notes"],
          properties: {
            binder: { type: "string", description: "As printed, e.g. C600, Multigrade, A15E, PMB, crumb rubber" },
            extra_per_t: { type: "number", description: "AUD per tonne added on top of the mix price. Negative if it's a discount." },
            applies_to: { type: ["string", "null"], description: "If the extra is only for some mixes (e.g. 'AC14 only'), say which; null for all mixes." },
            notes: { type: ["string", "null"] },
          },
        },
      },
      warnings: { type: "array", items: { type: "string" } },
    },
  },
} as const;

export function buildPriceListMessages(input: { plantName: string; text: string | null; imageUrls: string[]; existingNames: string[] }): ChatMessage[] {
  const system = [
    `# Role`,
    `You read a supplier's price list for a paving contractor and copy out each product and its price, for a person to check. The prices are for the supply plant "${input.plantName}".`,
    ``,
    `# Rules`,
    `1. Copy only prices that are printed. Never estimate, average or work out a price. If a price can't be read clearly, leave the line out and add a warning naming it.`,
    `2. rate is AUD per unit, as a plain number. If the list shows both ex GST and inc GST, use ex GST. Set gst to say which the printed prices are.`,
    `3. unit: "t" for per tonne, "m2", "m3", "each", "h", "day", "km"; "other" if it's something else (say what in notes).`,
    `4. kind: asphalt for asphalt or hotmix mixes (AC7, AC10, AC14, DG, SMA, OGA and so on); base for crushed rock, road base, CBR, gravel; prime for primer or tack coat; seal for bitumen seal or emulsion; otherwise other.`,
    `5. name: short and clear, keeping the mix code and binder (e.g. "AC10 C320", "AC14 Multigrade", "Type 2.1 crushed rock"). If one of the contractor's existing names below is clearly the same product, use that exact name.`,
    `6. Put conditions in notes (minimum order, small-load fee, delivered vs ex-plant). Put surcharges and fees that aren't products in warnings, not lines.`,
    `7. valid_until: the date the prices run to, if printed, as YYYY-MM-DD.`,
    `8. Binders. Plants often price each mix once (at a standard binder, usually C320) and then list extra charges for other binders. These are written many ways: "extra over", "EO", "E/O", "add for", "binder surcharge", "+$12/t", "premium", "upcharge", a "Binder" table with $/t, or a column per binder. Each of those is a binder_extras row: binder as printed (C170, C450, C600, Multigrade or M1000, PMB A10E/A15E/A20E/A25E/A35P, SBS, crumb rubber, EME2, warm mix), extra_per_t as the $ per tonne added. Don't put them in lines.`,
    `9. If a table prices the same mix in several binders (e.g. AC14 C320 $165, AC14 C600 $172), keep each as its own line with the binder in its name, and add no binder_extras for them. If the list gives the extra as a percentage or per litre, leave it out of binder_extras and add a warning saying what it said.`,
    `10. base_binder: the binder the plain mix prices include, if the list says so (e.g. "prices based on C320 bitumen"); if mixes are named without a binder and extras are listed for other binders, it's usually C320, so say C320. Null if there's nothing about binders.`,
    ``,
    `# The contractor's existing names`,
    input.existingNames.length ? input.existingNames.join("\n") : "None yet.",
    ``,
    `Reply with JSON only, matching schema price_list.`,
  ].join("\n");
  const parts: ChatPart[] = [
    { type: "text", text: input.text ? `Price list text (from a PDF):\n\n${input.text.slice(0, 40_000)}` : `The price list is in the attached image(s).` },
    ...input.imageUrls.slice(0, 6).map((url) => ({ type: "image_url" as const, image_url: { url } })),
  ];
  return [{ role: "system", content: system }, { role: "user", content: parts }];
}

const UNITS = new Set(["t", "m2", "m3", "each", "h", "day", "km", "other"]);
const KINDS = new Set(["asphalt", "base", "prime", "tack", "seal", "other"]);

/** Drop anything unusable; tidy names; flag inc-GST prices. */
export function cleanPriceList(raw: unknown): PriceListRead {
  const o = (raw && typeof raw === "object" ? raw : {}) as Partial<PriceListRead>;
  const warnings = Array.isArray(o.warnings) ? o.warnings.filter((w) => typeof w === "string").slice(0, 20) : [];
  const seen = new Set<string>();
  const lines: PriceListLine[] = [];
  for (const l of Array.isArray(o.lines) ? o.lines : []) {
    const name = String(l?.name ?? "").replace(/\s+/g, " ").trim().slice(0, 120);
    const rate = Number(l?.rate);
    if (!name || !Number.isFinite(rate) || rate <= 0 || rate > 1_000_000) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) { warnings.push(`"${name}" was listed twice; kept the first price.`); continue; }
    seen.add(key);
    lines.push({
      name,
      unit: UNITS.has(l.unit) ? l.unit : "other",
      rate: Math.round(rate * 100) / 100,
      kind: KINDS.has(l.kind) ? l.kind : "other",
      notes: l.notes ? String(l.notes).slice(0, 300) : null,
    });
  }
  const gst = o.gst === "included" || o.gst === "excluded" ? o.gst : "unknown";
  if (gst === "included") warnings.unshift("These prices include GST. Your costs are ex GST: check and divide by 1.1 before importing.");
  const valid = typeof o.valid_until === "string" && /^\d{4}-\d{2}-\d{2}$/.test(o.valid_until) ? o.valid_until : null;
  const extras: BinderExtraLine[] = [];
  const seenB = new Set<string>();
  for (const e of Array.isArray(o.binder_extras) ? o.binder_extras : []) {
    const binder = normaliseBinder(String(e?.binder ?? ""));
    const x = Number(e?.extra_per_t);
    if (!binder || !Number.isFinite(x) || Math.abs(x) > 2000) continue;
    const key = `${binder}|${e?.applies_to ?? ""}`;
    if (seenB.has(key)) continue;
    seenB.add(key);
    extras.push({ binder, extra_per_t: Math.round(x * 100) / 100, applies_to: e?.applies_to ? String(e.applies_to).slice(0, 120) : null, notes: e?.notes ? String(e.notes).slice(0, 200) : null });
  }
  const base = normaliseBinder(typeof o.base_binder === "string" ? o.base_binder : null);
  return { supplier: o.supplier ? String(o.supplier).slice(0, 120) : null, valid_until: valid, gst, lines, base_binder: base, binder_extras: extras.filter((e) => e.binder !== base), warnings };
}

export type PriceListCall = (messages: ChatMessage[]) => Promise<ProviderResult>;

export async function readPriceList(call: PriceListCall, input: Parameters<typeof buildPriceListMessages>[0]): Promise<PriceListRead> {
  if (!input.text?.trim() && input.imageUrls.length === 0) throw new Error("Nothing to read in that file.");
  const run = await call(buildPriceListMessages(input));
  return cleanPriceList(run.json);
}

/** Which rows would update an existing price at this plant, and which are new. */
export function matchToLibrary(lines: { name: string }[], library: CostItem[], plantId: string): (string | null)[] {
  const atPlant = library.filter((c) => c.active && c.supply_plant_id === plantId);
  return lines.map((l) => atPlant.find((c) => c.name.trim().toLowerCase() === l.name.trim().toLowerCase())?.id ?? null);
}

/** Typical densities for a mix sold by the tonne (t/m³), so tonnes can be worked out from area and depth. */
export function defaultDensity(kind: PriceListLine["kind"]): number | null {
  return kind === "asphalt" ? 2.4 : kind === "base" ? 2.2 : null;
}

/** Plain text from a PDF (empty for a scanned PDF with no text layer). */
export async function pdfText(bytes: Uint8Array): Promise<string> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(bytes);
  // Page by page with a marker, so notes can say which sheet ("--- page 3 ---").
  const { text } = await extractText(pdf, { mergePages: false });
  const pages = (Array.isArray(text) ? text : [String(text ?? "")]).map((t) => String(t ?? "").trim());
  return pages.length > 1 ? pages.map((t, i) => `--- page ${i + 1} ---\n${t}`).join("\n").trim() : (pages[0] ?? "").trim();
}
