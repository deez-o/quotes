"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { requireTenant } from "@/lib/tenant";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadAccess } from "@/lib/access-load";
import { checkoutUrl, isPaidPlan, portalUrl, stripeClient, switchPlan, tenantFromSubscription } from "@/lib/stripe";
import { PLANS } from "@/lib/plans";

type Result = { ok: true; url?: string; message?: string } | { ok: false; message: string };

async function origin() {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "quoteout.app";
  return `${host.startsWith("localhost") ? "http" : "https"}://${host}`;
}

const LIVE_SUB = ["active", "trialing", "past_due"];

/**
 * Pick or change plan. With a live subscription the change happens straight away
 * (Stripe charges or credits the difference). Otherwise it opens Stripe's checkout.
 */
export async function choosePlan(plan: string): Promise<Result> {
  try {
    const ctx = await requireTenant();
    if (ctx.role !== "admin") return { ok: false, message: "Only your company's admin can change the plan." };
    if (!isPaidPlan(plan)) return { ok: false, message: "Pick a plan." };
    const stripe = stripeClient();
    if (!stripe) return { ok: false, message: "Online payments aren't switched on yet. Contact quoteout to change your plan." };
    const db = createAdminClient();
    const { tenant } = await loadAccess(ctx.tenant.id);

    if (tenant.stripe_subscription_id && LIVE_SUB.includes(tenant.billing_status ?? "")) {
      const sub = await switchPlan(stripe, tenant.stripe_subscription_id, plan);
      await db.from("tenants").update(tenantFromSubscription(sub, tenant)).eq("id", tenant.id);
      revalidatePath("/", "layout");
      return { ok: true, message: `You're on ${PLANS[plan].name} now. Stripe has charged or credited the difference for this month.` };
    }
    return { ok: true, url: await checkoutUrl(stripe, db, tenant, ctx.email, plan, await origin()) };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Couldn't change the plan." };
  }
}

/** Stripe's page for card details, invoices and cancelling. */
export async function manageBilling(): Promise<Result> {
  try {
    const ctx = await requireTenant();
    if (ctx.role !== "admin") return { ok: false, message: "Only your company's admin can manage billing." };
    const stripe = stripeClient();
    if (!stripe) return { ok: false, message: "Online payments aren't switched on yet." };
    const { tenant } = await loadAccess(ctx.tenant.id);
    if (!tenant.stripe_customer_id) return { ok: false, message: "Pick a plan first." };
    return { ok: true, url: await portalUrl(stripe, tenant.stripe_customer_id, await origin()) };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Couldn't open billing." };
  }
}
