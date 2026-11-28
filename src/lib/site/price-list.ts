/**
 * Reading a supplier's price list (PDF, photo or phone screenshot) into rows the user checks
 * before anything is saved. The AI only copies prices that are printed; it never works one out.
 */
import type { ChatMessage, ChatPart, ProviderResult } from "@/lib/quote/provider";
import type { CostItem } from "./price";
import { binderInName, normaliseBinder } from "@/lib/binder";
import { knownMix } from "@/lib/mixes";

export type PriceListLine = {
  name: string;
  /** As printed, mapped to our units where it's clear. */
  unit: "t" | "m2" | "m3" | "each" | "h" | "day" | "km" | "other";
  rate: number;
  kind: "asphalt" | "base" | "prime" | "tack" | "seal" | "other";
  notes: string | null;
  /** For a sliding scale: the band this price is for, as printed (e.g. "50-200 t"). "" if none. */
  band?: string;
};

/**
 * Something about how the list is laid out that the contractor decides before it goes in:
 * prices with GST, a mix priced in several binders, delivered prices, a sliding scale.
 */
export type PriceListQuestion = { topic: "gst" | "binders" | "delivered" | "bands" | "other"; question: string; options: string[]; suggested: number };

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
  questions: PriceListQuestion[];
};

export const PRICE_LIST_SCHEMA = {
  name: "price_list",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["supplier", "valid_until", "gst", "lines", "base_binder", "binder_extras", "warnings", "questions"],
    properties: {
      supplier: { type: ["string", "null"] },
      valid_until: { type: ["string", "null"], description: "YYYY-MM-DD if printed" },
      gst: { type: "string", enum: ["excluded", "included", "unknown"] },
      lines: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["name", "unit", "rate", "kind", "notes", "band"],
          properties: {
            name: { type: "string" },
            band: { type: "string", description: "Sliding scale: the quantity band this price is for, as printed (e.g. '0-50 t'). Empty if the list has no bands." },
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
      questions: {
        type: "array", description: "How should this list go in? Only where the layout isn't a plain price per product: ask the contractor, with the choices and the one you suggest.",
        items: {
          type: "object", additionalProperties: false, required: ["topic", "question", "options", "suggested"],
          properties: {
            topic: { type: "string", enum: ["gst", "binders", "delivered", "bands", "other"] },
            question: { type: "string" },
            options: { type: "array", items: { type: "string" }, description: "2-4 short choices. For gst: ['Take GST off (÷ 1.1)', 'They are already ex GST']. For binders: ['Keep each binder as its own mix', 'One price per mix, other binders as extras']. For delivered: ['We cart it (ex-plant prices)', 'The price includes delivery']. For bands: one per band as printed." },
            suggested: { type: "number", description: "Index of the option you'd pick" },
          },
        },
      },
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
    `11. Plants price in different ways. Where the list isn't a plain price per product, add a question so the contractor decides how it goes in: prices shown inc GST (topic gst); the same mix priced in several binders (topic binders); delivered prices or cartage built in (topic delivered); a sliding scale by quantity (topic bands: one line per band with band set, and one option per band); anything else odd (topic other, e.g. per-load fees, minimums, prices per m² for asphalt). Suggest the usual choice. No questions for a plain list.`,
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
    const key = `${name.toLowerCase()}|${typeof l?.band === "string" ? l.band.trim().toLowerCase() : ""}`;
    if (seen.has(key)) { warnings.push(`"${name}" was listed twice; kept the first price.`); continue; }
    seen.add(key);
    lines.push({
      name,
      unit: UNITS.has(l.unit) ? l.unit : "other",
      rate: Math.round(rate * 100) / 100,
      kind: KINDS.has(l.kind) ? l.kind : "other",
      notes: l.notes ? String(l.notes).slice(0, 300) : null,
      band: typeof l.band === "string" ? l.band.trim().slice(0, 40) : "",
    });
  }
  const gst = o.gst === "included" || o.gst === "excluded" ? o.gst : "unknown";
  const questions: PriceListQuestion[] = [];
  for (const q of Array.isArray(o.questions) ? o.questions : []) {
    const topic = ["gst", "binders", "delivered", "bands", "other"].includes(q?.topic) ? q.topic : "other";
    const options = (Array.isArray(q?.options) ? q.options : []).map((x) => String(x).slice(0, 80)).filter(Boolean).slice(0, 6);
    if (!q?.question || options.length < 2 || questions.some((x) => x.topic === topic && topic !== "other")) continue;
    questions.push({ topic, question: String(q.question).slice(0, 200), options, suggested: Math.min(options.length - 1, Math.max(0, Math.round(Number(q.suggested) || 0))) });
  }
  if (gst === "included" && !questions.some((q) => q.topic === "gst")) questions.unshift({ topic: "gst", question: "These prices include GST. Your costs are ex GST.", options: ["Take GST off (÷ 1.1)", "They are already ex GST"], suggested: 0 });
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
  return { supplier: o.supplier ? String(o.supplier).slice(0, 120) : null, valid_until: valid, gst, lines, base_binder: base, binder_extras: extras.filter((e) => e.binder !== base), warnings, questions: questions.slice(0, 6) };
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

/** A line ready to import, after the contractor's answers. */
export type ChosenLine = PriceListLine & { delivered: boolean };

/**
 * The list after the contractor's answers (`picks[i]` = the option chosen for questions[i]):
 * GST taken off; one price per mix with the other binders as extras (worked out from the
 * difference); delivered prices marked; only the chosen band of a sliding scale.
 */
export function applyAnswers(read: PriceListRead, picks: number[]): { lines: ChosenLine[]; extras: BinderExtraLine[]; base: string | null } {
  let lines: ChosenLine[] = read.lines.map((l) => ({ ...l, delivered: false }));
  let extras = [...read.binder_extras];
  let base = read.base_binder;
  read.questions.forEach((q, i) => {
    const pick = picks[i] ?? q.suggested;
    const chosen = (q.options[pick] ?? "").toLowerCase();
    if (q.topic === "gst" && /off|÷|divide|remove/.test(chosen)) lines = lines.map((l) => ({ ...l, rate: Math.round((l.rate / 1.1) * 100) / 100 }));
    if (q.topic === "delivered" && /includ|deliver/.test(chosen) && !/we cart|ex.?plant/.test(chosen)) lines = lines.map((l) => (l.kind === "asphalt" || l.kind === "base" ? { ...l, delivered: true } : l));
    if (q.topic === "bands") {
      const band = q.options[pick] ?? "";
      lines = lines.filter((l) => !l.band || l.band.toLowerCase() === band.toLowerCase());
    }
    if (q.topic === "binders" && /extra|one price/.test(chosen)) {
      // Group each mix's binder versions; the base binder (C320 unless said) stays as the mix price.
      const b = base ?? "C320";
      const groups = new Map<string, { line: ChosenLine; binder: string | null }[]>();
      for (const l of lines.filter((x) => x.kind === "asphalt")) {
        const binder = binderInName(l.name);
        const mix = (knownMix(l.name) ?? l.name.replace(/\b(C\d{3}|M1000|multigrade|A\d{2}[EP]|PMB|SBS|crumb( rubber)?)\b/gi, "").replace(/\s+/g, " ").trim()).toLowerCase();
        groups.set(mix, [...(groups.get(mix) ?? []), { line: l, binder }]);
      }
      const diffs = new Map<string, number[]>();
      const drop = new Set<ChosenLine>();
      for (const g of groups.values()) {
        const baseLine = g.find((x) => !x.binder || x.binder === b);
        if (!baseLine || g.length < 2) continue;
        for (const x of g) {
          if (x === baseLine || !x.binder) continue;
          diffs.set(x.binder, [...(diffs.get(x.binder) ?? []), x.line.rate - baseLine.line.rate]);
          drop.add(x.line);
        }
      }
      lines = lines.filter((l) => !drop.has(l));
      for (const [binder, ds] of diffs) {
        if (extras.some((e) => e.binder === binder)) continue;
        const same = ds.every((d) => Math.abs(d - ds[0]) < 0.01);
        extras.push({ binder, extra_per_t: Math.round((ds.reduce((s2, d) => s2 + d, 0) / ds.length) * 100) / 100, applies_to: null, notes: same ? null : "Worked out as the average difference: it varies by mix, check it" });
      }
      base = b;
    }
  });
  if (base) extras = extras.filter((e) => e.binder !== base);
  return { lines, extras, base };
}
