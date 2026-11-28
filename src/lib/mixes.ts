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
