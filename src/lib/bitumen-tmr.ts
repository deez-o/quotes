/**
 * TMR publishes its Bitumen Price Index as a PDF each month: lines like "September 2026 1878.59".
 * Read the months and values out of the PDF's text.
 */
export const TMR_INDEX_URLS = [
  "https://www.tmr.qld.gov.au/-/media/busind/techstdpubs/Contract/Infrastructure-Contract/Bitumen-Price-Index.pdf",
  "https://www.tmr.qld.gov.au/_/media/busind/techstdpubs/contract/infrastructure-contract/bitumen-price-index.pdf",
];

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

export function parseTmrIndex(text: string): { month: string; value: number }[] {
  const out = new Map<string, number>();
  const re = /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(20\d{2})\s+\$?\s*([\d,]{3,7}(?:\.\d{1,2})?)\b/gi;
  for (const m of text.matchAll(re)) {
    const month = `${m[2]}-${String(MONTHS.indexOf(m[1].toLowerCase()) + 1).padStart(2, "0")}-01`;
    const value = Number(m[3].replace(/,/g, ""));
    if (value >= 300 && value <= 6000) out.set(month, value); // a $/t bitumen price, not a stray number
  }
  return [...out.entries()].map(([month, value]) => ({ month, value })).sort((a, b) => a.month.localeCompare(b.month));
}
