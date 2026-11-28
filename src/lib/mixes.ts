/**
 * The asphalt mixes that are real (AC7/10/14/20 M or H, OG10/14, SMA10/14, EME2, plus Type 1-4), so an RFQ asking for one we have no price
 * for prompts "add it to your costs" rather than a vague "which mix?".
 */
const KNOWN: [RegExp, string][] = [
  [/\bEME\s?2\b/i, "EME2"],
  [/\bSMA\s?(10|14)\b/i, "SMA$1"],
  [/\bOG(?:A)?\s?(10|14)\b/i, "OG$1"],
  [/\bAC\s?(7|10|14|20)[HM]?\b/i, "AC$1"], // AC14H, AC10M: H/M is the traffic class
  [/\bType\s?([1-4])\b/i, "Type$1"],
];

/** The known mix an item asks for, e.g. "Supply and lay EME2, 85 mm" -> "EME2". Null if none. */
export function knownMix(text: string): string | null {
  for (const [re, name] of KNOWN) {
    const m = text.match(re);
    if (m) return name.replace("$1", m[1] ?? "");
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
  NSW: ["AC10", "AC14", "AC20"], VIC: ["AC10", "AC14", "AC20"], SA: ["AC10", "AC14", "AC20"], WA: ["AC10", "AC14", "AC20"],
  TAS: ["AC10", "AC14", "AC20"], NT: ["AC10", "AC14", "AC20"], ACT: ["AC10", "AC14", "AC20"],
};

/** Mixes that come with their own binder in the price (never a binder extra-over): EME2, and PMB for OG and SMA. */
export function ownBinder(mixName: string): string | null {
  if (/\bEME\s?2\b/i.test(mixName)) return "EME2";
  if (/\b(OG(?:A)?|SMA)\s?\d/i.test(mixName)) return "PMB";
  return null;
}
