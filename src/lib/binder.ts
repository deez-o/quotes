/**
 * Asphalt binders: one name for each, however a plant's price list or an RFQ writes it.
 * "Class 320", "C320 bitumen" and "320" are all C320; "PMB A15E", "SBS A15E" are A15E;
 * "crumb rubber", "CRB" and "rubberised" are Crumb rubber.
 */

export const BINDERS: { code: string; label: string }[] = [
  { code: "C170", label: "C170" },
  { code: "C240", label: "C240" },
  { code: "C320", label: "C320" },
  { code: "C450", label: "C450" },
  { code: "C600", label: "C600" },
  { code: "M1000", label: "MG (Multigrade)" },
  { code: "M500", label: "Multigrade (M500)" },
  { code: "A10E", label: "PMB A10E" },
  { code: "A15E", label: "PMB A15E" },
  { code: "A20E", label: "PMB A20E" },
  { code: "A25E", label: "PMB A25E" },
  { code: "A30P", label: "PMB A30P" },
  { code: "A35P", label: "PMB A35P" },
  { code: "A40R", label: "PMB A40R" },
  { code: "CRUMB", label: "Crumb rubber" },
  { code: "EME2", label: "EME2 (hard grade)" },
  { code: "WARM", label: "Warm mix additive" },
  { code: "RAP", label: "RAP / recycled" },
];

const LABEL = new Map(BINDERS.map((b) => [b.code, b.label]));

/** The usual extras, offered first; anything else can be typed in. */
export const COMMON_EXTRAS = ["C600", "M1000", "EME2", "A15E", "CRUMB"];
/** What plants usually base their mix prices on. */
export const COMMON_BASES = ["C320", "C170", "C450", "C600"];

export function binderLabel(code: string | null | undefined): string {
  if (!code) return "";
  return LABEL.get(code) ?? code;
}

/** Any way a binder is written -> its code. Unknown binders come back tidied, not dropped. */
export function normaliseBinder(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = raw.toUpperCase().replace(/[–—]/g, "-").replace(/\s+/g, " ").trim();
  if (!s) return null;
  if (/CRUMB|RUBBER|\bCRB\b|\bCRA\b/.test(s)) return "CRUMB";
  if (/\bEME ?2?\b/.test(s)) return "EME2";
  if (/WARM ?MIX|\bWMA\b/.test(s)) return "WARM";
  if (/\bRAP\b|RECYCL/.test(s)) return "RAP";
  const pmb = /\bA ?(10|15|20|25|30|35|40) ?([EPR])\b/.exec(s);
  if (pmb) return `A${pmb[1]}${pmb[2]}`;
  if (/\bMG\b/.test(s)) return "M1000"; // "MG" is how most people write Multigrade
  const multi = /\bM ?(1000|500)\b/.exec(s);
  if (multi) return `M${multi[1]}`;
  if (/MULTI ?GRADE/.test(s)) return "M1000";
  const cls = /\b(?:C|CLASS|CL\.?) ?-?(170|240|320|450|600)\b/.exec(s) ?? /(?:^|[^\d])(170|240|320|450|600)(?:[^\d]|$)/.exec(s);
  if (cls) return `C${cls[1]}`;
  return raw.replace(/\s+/g, " ").trim().slice(0, 40);
}

/** The binder named in a mix's name ("AC14 A15E" -> A15E), or null if it doesn't say. */
export function binderInName(name: string): string | null {
  const s = name.toUpperCase();
  if (!/CRUMB|RUBBER|\bCRB\b|\bEME|\bMG\b|MULTI ?GRADE|\bM ?(1000|500)\b|\bA ?(10|15|20|25|30|35|40) ?[EPR]\b|\b(?:C|CLASS) ?-?(170|240|320|450|600)\b/.test(s)) return null;
  return normaliseBinder(s);
}

export type BinderExtra = { supply_plant_id: string; binder: string; extra_per_t: number };
export type BinderSetup = {
  /** The binder each plant's mix prices are based on (usually C320). */
  plantBase: Record<string, string>;
  extras: BinderExtra[];
  /** The company's default when the job doesn't say. */
  defaultBinder: string | null;
};

/**
 * Extra $/t for a mix in a given binder at a plant.
 * none: same binder as the mix price. extra: add this. missing: no extra-over set up for that binder.
 */
export function binderExtraFor(setup: BinderSetup | undefined, plantId: string | null | undefined, mixName: string, wanted: string | null | undefined):
  { kind: "none" } | { kind: "extra"; binder: string; extra: number; base: string } | { kind: "missing"; binder: string; base: string } {
  const binder = normaliseBinder(wanted ?? null);
  if (!setup || !plantId || !binder) return { kind: "none" };
  const base = binderInName(mixName) ?? setup.plantBase[plantId] ?? "C320";
  if (base === binder) return { kind: "none" };
  const hit = setup.extras.find((e) => e.supply_plant_id === plantId && e.binder === binder);
  if (hit) return { kind: "extra", binder, extra: hit.extra_per_t, base };
  return { kind: "missing", binder, base };
}
