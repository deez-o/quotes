import "server-only";
import Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";
import { PLANS, type PlanId } from "@/lib/plans";

import { LOOKUP, PAID_PLANS, isPaidPlan, planFromLookupKey, type PaidPlan } from "@/lib/stripe-keys";
export { PAID_PLANS, isPaidPlan, planFromLookupKey, type PaidPlan };

export function stripeClient(): Stripe | null {
  const key = process.env.STRIPE_SECRET_KEY;
  return key ? new Stripe(key) : null;
}


/**
 * The monthly price for a plan, made in Stripe the first time it's needed (AUD, ex GST).
 * Changing a price later: bump the _v1 in LOOKUP so new customers get the new price and
 * existing ones keep theirs.
 */
export async function priceFor(stripe: Stripe, plan: PaidPlan): Promise<string> {
  const lookup = LOOKUP(plan);
  const found = await stripe.prices.list({ lookup_keys: [lookup], active: true, limit: 1 });
  if (found.data[0]) return found.data[0].id;
  const p = PLANS[plan];
  const product = await stripe.products.create({ name: `quoteout ${p.name}`, description: p.blurb, metadata: { quoteout_plan: plan } });
  const price = await stripe.prices.create({
    product: product.id, currency: "aud", unit_amount: Math.round((p.priceMonthly ?? 0) * 100),
    recurring: { interval: "month" }, lookup_key: lookup, tax_behavior: "exclusive", metadata: { quoteout_plan: plan },
  });
  return price.id;
}

/** 10% GST added on top of the ex-GST plan price. */
export async function gstRate(stripe: Stripe): Promise<string> {
  const list = await stripe.taxRates.list({ active: true, limit: 100 });
  const hit = list.data.find((r) => r.metadata?.quoteout === "gst");
  if (hit) return hit.id;
  const made = await stripe.taxRates.create({
    display_name: "GST", percentage: 10, inclusive: false, country: "AU", jurisdiction: "AU", description: "Australian GST", metadata: { quoteout: "gst" },
  });
  return made.id;
}

type Tenant = { id: string; name: string; stripe_customer_id: string | null };

/** The company's Stripe customer, made if it doesn't have one yet. */
export async function customerFor(stripe: Stripe, db: SupabaseClient, t: Tenant, email: string | null): Promise<string> {
  if (t.stripe_customer_id) return t.stripe_customer_id;
  const c = await stripe.customers.create({ name: t.name, email: email ?? undefined, metadata: { tenant_id: t.id } });
  await db.from("tenants").update({ stripe_customer_id: c.id }).eq("id", t.id);
  return c.id;
}

/** Stripe's checkout page for a plan. */
export async function checkoutUrl(stripe: Stripe, db: SupabaseClient, t: Tenant, email: string | null, plan: PaidPlan, origin: string) {
  const [customer, price, gst] = await Promise.all([customerFor(stripe, db, t, email), priceFor(stripe, plan), gstRate(stripe)]);
  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer,
    client_reference_id: t.id,
    line_items: [{ price, quantity: 1 }],
    subscription_data: { default_tax_rates: [gst], metadata: { tenant_id: t.id, plan } },
    metadata: { tenant_id: t.id, plan },
    allow_promotion_codes: true,
    billing_address_collection: "auto",
    success_url: `${origin}/billing?paid=1`,
    cancel_url: `${origin}/billing?cancelled=1`,
  });
  if (!session.url) throw new Error("Stripe didn't return a checkout page.");
  return session.url;
}

/** Move an existing subscription to another plan now, charging or crediting the difference. */
export async function switchPlan(stripe: Stripe, subscriptionId: string, plan: PaidPlan) {
  const sub = await stripe.subscriptions.retrieve(subscriptionId);
  const item = sub.items.data[0];
  if (!item) throw new Error("That subscription has no plan on it.");
  const price = await priceFor(stripe, plan);
  return stripe.subscriptions.update(subscriptionId, {
    items: [{ id: item.id, price }],
    proration_behavior: "always_invoice",
    payment_behavior: "pending_if_incomplete",
    metadata: { ...sub.metadata, plan },
  });
}

/** Stripe's own page for changing card details, cancelling and downloading invoices. */
export async function portalUrl(stripe: Stripe, customer: string, origin: string) {
  const s = await stripe.billingPortal.sessions.create({ customer, return_url: `${origin}/billing` });
  return s.url;
}

/** What a Stripe subscription means for the company record. */
export function tenantFromSubscription(sub: Stripe.Subscription, current: { past_due_since: string | null }) {
  const plan = planFromLookupKey(sub.items.data[0]?.price?.lookup_key) ?? (isPaidPlan(String(sub.metadata?.plan)) ? (sub.metadata.plan as PaidPlan) : null);
  const status = sub.status as string;
  return {
    stripe_subscription_id: sub.id,
    billing_status: status,
    past_due_since: status === "past_due" ? (current.past_due_since ?? new Date().toISOString()) : null,
    ...(plan && status !== "canceled" && status !== "incomplete_expired" ? { plan: plan as PlanId, trial_ends_at: null } : {}),
  };
}
