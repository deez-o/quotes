/**
 * Bitumen rise and fall: the binder in the asphalt, priced at today's index against the
 * index for the month the quote was priced. Code does the maths; the index comes from
 * TMR's monthly bitumen price index ($ per tonne).
 */
export type BitumenIndex = { month: string; value: number };

export function riseAndFall(input: { asphaltTonnes: number; binderPercent: number; baseIndex: number; currentIndex: number }) {
  const binderTonnes = (input.asphaltTonnes * input.binderPercent) / 100;
  const change = input.currentIndex - input.baseIndex;
  return { binderTonnes: Math.round(binderTonnes * 100) / 100, change: Math.round(change * 100) / 100, amount: Math.round(binderTonnes * change * 100) / 100 };
}

/** The index for a month, or the latest one before it. */
export function indexFor(list: BitumenIndex[], month: string): BitumenIndex | null {
  const m = month.slice(0, 7);
  return [...list].sort((a, b) => b.month.localeCompare(a.month)).find((x) => x.month.slice(0, 7) <= m) ?? null;
}

export const monthName = (m: string) => new Date(`${m.slice(0, 7)}-01T00:00:00`).toLocaleDateString("en-AU", { month: "long", year: "numeric" });
