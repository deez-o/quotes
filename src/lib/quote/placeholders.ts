/**
 * The words people see in square brackets in the email and terms boxes, and the
 * fill-in codes stored behind them. People edit "[Customer]"; we keep "{customer}".
 */
export const FILL_INS: [code: string, shown: string, example: string][] = [
  ["customer", "Customer", "Sam"],
  ["quote_no", "Quote number", "Q-0012"],
  ["job", "Job", "Carpark resurfacing"],
  ["price_summary", "Price", "The total is $12,100.00 inc GST ($11,000.00 ex GST)."],
  ["total", "Total inc GST", "$12,100.00"],
  ["total_ex", "Total ex GST", "$11,000.00"],
  ["phone_line", "or call your phone", " or call 0400 000 000"],
  ["phone", "Phone", "0400 000 000"],
  ["sender", "Your name", "Dan"],
  ["business", "Business name", "Smith Asphalt"],
  ["bitumen_month", "Bitumen month", "November 2026"],
];

/** Codes → the words people see. */
export function toShown(text: string): string {
  let out = text;
  for (const [code, shown] of FILL_INS) out = out.split(`{${code}}`).join(`[${shown}]`);
  return out;
}

/** The words people see → codes (case and spacing forgiven). Unknown [brackets] are left as typed. */
export function toCodes(text: string): string {
  return text.replace(/\[([^\]\n]{1,40})\]/g, (m, inner: string) => {
    const k = inner.trim().toLowerCase().replace(/\s+/g, " ");
    const hit = FILL_INS.find(([code, shown]) => shown.toLowerCase() === k || code === k);
    return hit ? `{${hit[0]}}` : m;
  });
}
