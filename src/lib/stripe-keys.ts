/** Paid plans that are sold through Stripe, and how their Stripe prices are named. */
export const PAID_PLANS = ["site", "pro", "business"] as const;
export type PaidPlan = (typeof PAID_PLANS)[number];

// v2: Nov 2026 pricing (Starter $299 / Pro $449 / Business $799). Existing subscribers keep their v1 price.
export const LOOKUP = (p: PaidPlan) => `quoteout_${p}_monthly_v2`;
export const TOPUP_LOOKUP = "quoteout_topup10_v1";

export function isPaidPlan(p: string): p is PaidPlan {
  return (PAID_PLANS as readonly string[]).includes(p);
}

/** The plan a Stripe price stands for, from its lookup key. */
export function planFromLookupKey(key: string | null | undefined): PaidPlan | null {
  const m = /^quoteout_(site|pro|business)_monthly_v\d+$/.exec(key ?? "");
  return m ? (m[1] as PaidPlan) : null;
}
