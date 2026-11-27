/** Standard quote terms. {bitumen_month} becomes the month the quote was done, e.g. "November 2026". */
export const DEFAULT_TERMS =
  "Valid for 30 days. Prices are subject to rise and fall in line with the bitumen index, and are based on the bitumen price for {bitumen_month}. " +
  "Price assumes clear access during normal working hours. Traffic management, line marking and kerbing are excluded unless listed.";

export function renderTerms(terms: string | null | undefined, quotedAt: Date | string): string {
  const month = new Date(quotedAt).toLocaleDateString("en-AU", { month: "long", year: "numeric", timeZone: "Australia/Brisbane" });
  return (terms?.trim() || DEFAULT_TERMS).replace(/\{bitumen_month\}/g, month);
}
