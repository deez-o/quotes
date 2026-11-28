/**
 * The asphalt mixes that are real (AC7/10/14/20 M or H, OG10/14, SMA10/14, EME2, plus Type 1-4), so an RFQ asking for one we have no price
 * for prompts "add it to your costs" rather than a vague "which mix?".
 */
const KNOWN: [RegExp, string][] = [
  [/\bEME\s?2\b/i, "EME2"],
  [/\bSMA\s?(10|14)\b/i, "SMA$1"],
  [/\bOG(?:A)?\s?(10|14)\b/i, "OG$1"],
  [/\bFine\s?AC\s?(7|10)\b/i, "FineAC$1"], // SA light-medium duty
  [/\bAC\s?(14|20)\s?IC\b/i, "AC$1 IC"], // WA intersection mixes
  [/\bAC\s?(7|10|14|20|28)[HM]?\b/i, "AC$1"], // AC14H, AC10M: H/M is the traffic class
  [/\b(?:Mix\s?)?Type\s?([1-6])\b/i, "Type$1"],
  [/\b(?:Size\s?)?(7|10|14|20)\s?(?:Type\s?)?(HP|VP|SI|SF|SP|SS|N|H|V|L)\b/, "$1$2"], // VIC / TAS: 10N, Size 14 Type H
];

/** The known mix an item asks for, e.g. "Supply and lay EME2, 85 mm" -> "EME2". Null if none. */
export function knownMix(text: string): string | null {
  for (const [re, name] of KNOWN) {
    const m = text.match(re);
    if (m) return name.replace("$1", m[1] ?? "").replace("$2", (m[2] ?? "").toUpperCase());
  }
  return null;
}

/** True when the library has a mix with that name (e.g. "AC14 C320" counts for AC14). */
export function hasMix(names: string[], mix: string): boolean {
  const re = new RegExp(`\\b${mix.replace(/(\D)(\d)/, "$1\\s?$2")}\\b`, "i");
  return names.some((n) => re.test(n));
}

export const ADD_MIX = "Add mix:";

export const STATES = ["QLD", "NSW", "VIC", "SA", "WA", "TAS", "NT", "ACT"] as const;
export type AuState = (typeof STATES)[number];

/**
 * The usual mixes a new plant starts with, by state (names only: they type in the prices).
 * Queensland's list is confirmed; the others are a plain starting set until they're checked.
 */
export const STATE_MIXES: Record<AuState, string[]> = {
  QLD: ["AC7", "AC10", "AC14", "AC20", "OG10", "OG14", "SMA10", "SMA14", "EME2"],
  NSW: ["AC7", "AC10", "AC14", "AC20", "AC28", "SMA10", "SMA14", "OG10", "OG14", "EME2"],
  VIC: ["10N", "14N", "10H", "14H", "10V", "14V", "20SI", "10HP", "14VP"],
  TAS: ["10N", "14N", "10H", "14H", "20SI"],
  SA: ["AC10", "AC14", "FineAC7", "FineAC10", "SMA10", "OG10", "OG14"],
  WA: ["AC7", "AC10", "AC14", "AC14 IC", "AC20 IC", "SMA10"],
  NT: ["Mix Type 1", "Mix Type 2", "Mix Type 3", "Mix Type 4", "Mix Type 5", "Mix Type 6"],
  ACT: ["AC10", "AC14", "AC20", "SMA10", "SMA14"],
};

/** What a new plant's prices are usually based on, and the binders usually priced as extra-overs, by state. */
export const STATE_BINDERS: Record<AuState, { base: string; extras: string[] }> = {
  QLD: { base: "C320", extras: ["C600", "M1000", "A15E", "CRUMB"] },
  NSW: { base: "C320", extras: ["C450", "C600", "A15E", "CRUMB"] },
  VIC: { base: "C320", extras: ["C600", "A10E", "C170"] },
  TAS: { base: "C320", extras: ["C600", "A10E", "C170"] },
  SA: { base: "C320", extras: ["A15E", "C170"] },
  WA: { base: "C320", extras: ["A15E", "C170"] },
  NT: { base: "C320", extras: ["A15E", "S10E"] },
  ACT: { base: "C320", extras: ["A15E", "C450", "C600"] },
};

/**
 * Compacted layer depth each mix allows (mm), from the state specs (Australian_Asphalt_Specs, Nov 2026):
 * QLD TMR MRTS30 Table 8.6.1 / MRTS32 (verified); NSW R116/R121 3.0-5.0 x size (derived); SA DIT RD-BP-C3
 * (30 mm minimum, AC14 to 80 mm); WA MRWA 510 / ERN9; ACT MIS 03 (3 x size and 30 mm, collectors 45 mm);
 * VIC and TAS go by the drawings, so Austroads typical ranges (AP-T65 Table 8.1) with council norms.
 */
const DEPTHS: Record<AuState, Record<string, [number, number]>> = {
  QLD: { AC7: [25, 35], AC10: [35, 50], AC14: [50, 70], AC20: [60, 100], OG10: [25, 35], OG14: [35, 45], SMA10: [35, 40], SMA14: [50, 60], EME2: [70, 130] },
  NSW: { AC7: [21, 35], AC10: [30, 50], AC14: [42, 70], AC20: [60, 100], AC28: [84, 140], SMA10: [30, 50], SMA14: [42, 70] },
  VIC: { "10N": [25, 40], "14N": [35, 55], "10H": [25, 40], "14H": [35, 55], "20SI": [50, 80] },
  TAS: { "10N": [30, 40], "14N": [40, 55], "10H": [30, 40], "14H": [40, 55], "20SI": [50, 80] },
  SA: { FineAC7: [25, 35], FineAC10: [30, 40], AC10: [30, 45], AC14: [40, 80], SMA10: [30, 40] },
  WA: { AC7: [20, 30], AC10: [30, 40], AC14: [40, 55], "AC14 IC": [45, 55], "AC20 IC": [60, 90], SMA10: [30, 40] },
  NT: { AC7: [20, 30], AC10: [25, 40], AC14: [35, 55], AC20: [50, 80] },
  ACT: { AC10: [30, 50], AC14: [45, 70], AC20: [60, 100], SMA10: [40, 50], SMA14: [45, 70] },
};
const SPEC: Record<AuState, string> = {
  QLD: "TMR MRTS30", NSW: "TfNSW R116", VIC: "Austroads typical, DTP 407 goes by the drawings", TAS: "Austroads typical, State Growth 407",
  SA: "DIT RD-BP-C3", WA: "MRWA Spec 510", NT: "Austroads typical", ACT: "ACT MIS 03",
};
/** Dense graded mixes to suggest from a depth, smallest first (the wearing mix wins). */
const DENSE: Record<AuState, string[]> = {
  QLD: ["AC7", "AC10", "AC14", "AC20"], NSW: ["AC7", "AC10", "AC14", "AC20", "AC28"], VIC: ["10N", "14N", "20SI"], TAS: ["10N", "14N", "20SI"],
  SA: ["AC10", "AC14"], WA: ["AC7", "AC10", "AC14", "AC20 IC"], NT: ["AC7", "AC10", "AC14", "AC20"], ACT: ["AC10", "AC14", "AC20"],
};

/** A depth outside what the state's spec allows for the mix, as a short warning. Null if fine or unknown. */
export function depthWarning(state: string | null | undefined, mixText: string, depthMm: number | null): string | null {
  const st = (state ?? "QLD") as AuState;
  const mix = knownMix(mixText);
  const lim = mix ? (DEPTHS[st] ?? DEPTHS.QLD)[mix] : undefined;
  if (!lim || depthMm == null || !(depthMm > 0)) return null;
  // EME2 is usually laid as several layers: check the layer, not the total.
  const layers = mix === "EME2" && depthMm > lim[1] ? Math.ceil(depthMm / lim[1]) : 1;
  const layer = depthMm / layers;
  if (layer < lim[0]) return `${mix} at ${Math.round(layer)} mm is under the ${lim[0]} mm minimum (${SPEC[st] ?? SPEC.QLD}). Check the mix or depth.`;
  if (layer > lim[1]) return `${mix} at ${Math.round(layer)} mm is over the ${lim[1]} mm maximum a layer (${SPEC[st] ?? SPEC.QLD}): it may need two layers.`;
  return null;
}

/** Mixes that come with their own binder in the price (never a binder extra-over): EME2, and PMB for OG and SMA. */
export function ownBinder(mixName: string): string | null {
  if (/\bEME\s?2\b/i.test(mixName)) return "EME2";
  if (/\b(OG(?:A)?|SMA)\s?\d/i.test(mixName)) return "PMB";
  return null;
}

/**
 * The dense graded mix the state's spec allows at a depth, for an RFQ that gives a depth but no mix:
 * QLD 40 mm -> AC10, 60 mm -> AC14, 80 mm -> AC20. The smallest size that fits wins (it's the wearing mix).
 */
export function mixForDepth(state: string | null | undefined, depthMm: number | null): string | null {
  if (depthMm == null || !(depthMm > 0)) return null;
  const st = (state ?? "QLD") as AuState;
  const table = DEPTHS[st] ?? DEPTHS.QLD;
  const dense = (DENSE[st] ?? DENSE.QLD).filter((m) => table[m]).map((m) => [m, table[m]] as [string, [number, number]]);
  const fit = dense.find(([, [lo, hi]]) => depthMm >= lo && depthMm <= hi);
  if (fit) return fit[0];
  // Thicker than any one layer: the biggest dense mix (laid in layers).
  const last = dense[dense.length - 1];
  return depthMm > last[1][1] ? last[0] : dense[0][0];
}
