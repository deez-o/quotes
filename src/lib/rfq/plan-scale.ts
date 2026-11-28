/**
 * A drawing's scale, read from its title block ("SCALE 1:500 @ A1", "1:250 at A3"), and how
 * wide the whole sheet is on the ground. Used to lay a plan on the satellite map at true size.
 */

/** Sheet sizes in mm, landscape (long side first). */
export const SHEETS: Record<string, [number, number]> = { A0: [1189, 841], A1: [841, 594], A2: [594, 420], A3: [420, 297], A4: [297, 210] };

export type PlanScale = { ratio: number; sheet: keyof typeof SHEETS | null };

export function parseScale(text: string): PlanScale | null {
  const t = text.replace(/\s+/g, " ");
  // Prefer a scale that names its sheet; then one labelled SCALE; then any 1:n that's a drawing scale.
  const withSheet = /1\s*:\s*(\d{2,5})\s*(?:@|at|on)\s*(A[0-4])\b/i.exec(t);
  if (withSheet) return { ratio: Number(withSheet[1]), sheet: withSheet[2].toUpperCase() as PlanScale["sheet"] };
  const labelled = /scale[^0-9]{0,12}1\s*:\s*(\d{2,5})/i.exec(t);
  const any = labelled ?? /\b1\s*:\s*(50|100|125|200|250|300|400|500|750|1000|1250|1500|2000|2500)\b/.exec(t);
  if (!any) return null;
  const sheet = /\b(A[0-4])\b(?=[^a-z]{0,20}(sheet|size|paper|original))/i.exec(t)?.[1]?.toUpperCase() as PlanScale["sheet"] | undefined;
  return { ratio: Number(any[1]), sheet: sheet ?? null };
}

/**
 * Width of the whole page on the ground, in metres. If the scale says which sheet it's for
 * (e.g. "@ A1") that sheet's width is used, so a reduced A3 print of an A1 drawing still comes out right.
 */
export function groundWidthM(scale: PlanScale, pageWidthPt: number, pageHeightPt: number): number {
  const landscape = pageWidthPt >= pageHeightPt;
  const pageMm = (pageWidthPt * 25.4) / 72;
  const sheetMm = scale.sheet ? SHEETS[scale.sheet][landscape ? 0 : 1] : pageMm;
  return (sheetMm * scale.ratio) / 1000;
}
