/** How a quote is named: Q-0012, Q-0012 Rev B, Q-0012 Option B. */
export const revLetter = (rev: number) => String.fromCharCode(65 + Math.max(0, Math.min(25, rev)));
export function quoteLabel(q: { quote_no: string | null; revision?: number | null; option_label?: string | null }, withOption = true): string {
  return [q.quote_no ?? "Quote", q.revision ? `Rev ${revLetter(q.revision)}` : "", withOption && q.option_label ? `Option ${q.option_label}` : ""].filter(Boolean).join(" ");
}
