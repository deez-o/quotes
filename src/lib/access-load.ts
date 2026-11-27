import "server-only";
import { cache } from "react";
import { createAdminClient } from "@/lib/supabase/admin";
import { accessFor, type Access } from "@/lib/access";
import { planFor } from "@/lib/plans";

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
    const { count } = await db.from("usage_events").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("kind", "ai_quote");
    used = count ?? 0;
  }
  return { tenant, access: accessFor(tenant, used), trialQuotesUsed: used };
});
