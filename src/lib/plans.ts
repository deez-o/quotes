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
  trial: { id: "trial", name: "Trial", priceMonthly: 0, aiQuotes: 15, emailAutoQuote: true, connectedMailbox: false, maxDevices: 2, blurb: "14 days, everything in Pro, 15 AI quotes." },
  site: { id: "site", name: "Site", priceMonthly: 149, aiQuotes: 40, emailAutoQuote: false, connectedMailbox: false, maxDevices: 2, blurb: "Quote on site by voice and photos, import RFQs, paste emails." },
  pro: { id: "pro", name: "Pro", priceMonthly: 249, aiQuotes: 150, emailAutoQuote: true, connectedMailbox: false, maxDevices: 2, blurb: "Everything in Site, plus the email auto-quoter by forwarding." },
  business: { id: "business", name: "Business", priceMonthly: 449, aiQuotes: 500, emailAutoQuote: true, connectedMailbox: true, maxDevices: 3, blurb: "Everything in Pro, plus a connected Microsoft 365 or Gmail inbox." },
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

/** What each plan includes, as shown on sign-up and the billing page. */
export const PLAN_FEATURES: Record<"trial" | "site" | "pro" | "business", string[]> = {
  trial: ["Everything in Pro for 14 days", "15 AI quotes", "No card needed"],
  site: ["Quote on site by voice and photos", "Import an RFQ or paste an email", "40 AI quotes a month", "PDF and Xero, with your branding", "Your rates, plants and rules set up for you", "Unlimited users"],
  pro: ["Everything in Site", "Email auto-quoter: forward RFQs to your own quoteout address", "150 AI quotes a month"],
  business: ["Everything in Pro", "Connect your Microsoft 365 or Gmail inbox", "500 AI quotes a month"],
};
