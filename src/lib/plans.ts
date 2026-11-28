/**
 * quoteout's plans. Prices are AUD a month, ex GST. Every plan has unlimited users,
 * and every customer gets their rules and rates set up for them.
 * A company's own overrides (set in /admin) win over the plan's numbers.
 * Launch (founding-customer) prices: early customers keep these for life.
 */
export type PlanId = "trial" | "site" | "pro" | "business" | "pilot";

export type Plan = {
  id: PlanId;
  name: string;
  priceMonthly: number | null;
  aiQuotes: number | null; // a month; null = no limit
  emailAutoQuote: boolean; // forward RFQs to the company's quoteout address
  connectedMailbox: boolean; // Microsoft 365 / Gmail inbox connected
  maxDevices: number | null; // per login; null = no limit
  blurb: string;
};

export const PLANS: Record<PlanId, Plan> = {
  trial: { id: "trial", name: "Trial", priceMonthly: 0, aiQuotes: 15, emailAutoQuote: true, connectedMailbox: true, maxDevices: 3, blurb: "14 days, everything in Business, 15 AI quotes." },
  // Every plan has everything; they differ only in how many quotes a month. (Plan id "site" is Starter.)
  site: { id: "site", name: "Starter", priceMonthly: 299, aiQuotes: 30, emailAutoQuote: true, connectedMailbox: true, maxDevices: 3, blurb: "Everything quoteout does, 30 quotes a month." },
  pro: { id: "pro", name: "Pro", priceMonthly: 499, aiQuotes: 100, emailAutoQuote: true, connectedMailbox: true, maxDevices: 3, blurb: "Everything quoteout does, 100 quotes a month." },
  business: { id: "business", name: "Business", priceMonthly: 799, aiQuotes: 200, emailAutoQuote: true, connectedMailbox: true, maxDevices: null, blurb: "Everything quoteout does, 200 quotes a month." },
  pilot: { id: "pilot", name: "Pilot (free)", priceMonthly: 0, aiQuotes: null, emailAutoQuote: true, connectedMailbox: true, maxDevices: null, blurb: "Free, everything on, no limits. For partners and testing." },
};

export const PLAN_ORDER: PlanId[] = ["trial", "site", "pro", "business", "pilot"];

export function planFor(id: string | null | undefined): Plan {
  return PLANS[(id ?? "") as PlanId] ?? PLANS.trial;
}

export type TenantLimits = { plan: string | null; ai_quota_month: number | null; max_devices: number | null };

/** The numbers that actually apply to a company: its own override, else its plan's. */
export function limitsFor(t: TenantLimits) {
  const p = planFor(t.plan);
  return {
    plan: p,
    aiQuotes: t.ai_quota_month ?? p.aiQuotes,
    maxDevices: t.max_devices ?? p.maxDevices,
  };
}

/** This month's period key, as usage_events stores it (Brisbane time). */
export function periodNow(d = new Date()) {
  return d.toLocaleDateString("en-CA", { timeZone: "Australia/Brisbane" }).slice(0, 7);
}

/** Connecting a Microsoft 365 / Gmail inbox directly isn't switched on yet: say so rather than sell it. */
export const MAILBOX_READY = false;
const inbox = (t: string) => (MAILBOX_READY ? t : `${t} (coming soon)`);

/** What each plan includes, as shown on sign-up, the billing page and the website. */
const ALL = [inbox("quoteout watches your inbox and drafts every RFQ"), "Forward or upload RFQs, drawings and BOQs", "Quote on site by voice and photos", "Send from your own Outlook; customers accept online", "PDF and Xero, with your branding", "Unlimited users"];
export const PLAN_FEATURES: Record<"trial" | "site" | "pro" | "business", string[]> = {
  trial: ["Everything quoteout does, for 14 days", "15 quotes", "No card needed"],
  site: ["30 quotes a month", ...ALL],
  pro: ["100 quotes a month", ...ALL],
  business: ["200 quotes a month", ...ALL],
};

/** The plan most companies pick, shown first on the plan page. */
export const POPULAR_PLAN = "pro";

/** Top-ups once the month's quotes are used: they don't expire. Dearer per quote than moving up a plan. */
export const TOPUP = { quotes: 10, priceAud: 50 };

/**
 * What counts as a quote against the allowance: a new quote made on site, or an RFQ drafted the first time.
 * Re-reads, changes, options, revisions and price lists don't count.
 */
export const QUOTE_KINDS = ["ai_quote", "quote_drafted"];
