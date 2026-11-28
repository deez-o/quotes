import "server-only";
import { cache } from "react";
import { createAdminClient } from "@/lib/supabase/admin";
import { accessFor, type Access } from "@/lib/access";
import { planFor, QUOTE_KINDS } from "@/lib/plans";

export type BillingTenant = {
  id: string; name: string; plan: string | null; status: string; billing_status: string | null; trial_ends_at: string | null;
  past_due_since: string | null; ai_quota_month: number | null; stripe_customer_id: string | null; stripe_subscription_id: string | null;
};

/** The company's billing record and whether it can use quoteout right now. Cached per request. */
export const loadAccess = cache(async function loadAccess(tenantId: string): Promise<{ tenant: BillingTenant; access: Access; trialQuotesUsed: number }> {
  const db = createAdminClient();
  const { data: t } = await db.from("tenants")
    .select("id, name, plan, status, billing_status, trial_ends_at, past_due_since, ai_quota_month, stripe_customer_id, stripe_subscription_id")
    .eq("id", tenantId).single();
  const tenant = t as BillingTenant;
  let used = 0;
  if (planFor(tenant.plan).id === "trial") {
    const { count } = await db.from("usage_events").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).in("kind", QUOTE_KINDS);
    used = count ?? 0;
  }
  let access = accessFor(tenant, used);
  // Paid plans: a heads-up at 90% of the month's quotes, and when they're gone.
  const plan = planFor(tenant.plan);
  if (access.state === "ok" && !access.banner && plan.id !== "trial" && plan.id !== "pilot") {
    const { allowance } = await import("@/lib/quota");
    const a = await allowance(tenantId);
    if (a.cap != null && a.used >= a.cap * 0.9) {
      access = {
        ...access,
        banner: a.used >= a.cap
          ? a.credits > 0
            ? `You've used this month's ${a.cap} quotes: now using top-ups (${a.credits} left).`
            : `You've used all ${a.cap} quotes this month. New RFQs are filed but not read until you top up or move up a plan.`
          : `You've used ${a.used} of ${a.cap} quotes this month${a.credits ? `, plus ${a.credits} top-up${a.credits === 1 ? "" : "s"}` : ""}.`,
      };
    }
  }
  return { tenant, access, trialQuotesUsed: used };
});
