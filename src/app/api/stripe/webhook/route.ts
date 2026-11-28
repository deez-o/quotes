import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { stripeClient, tenantFromSubscription } from "@/lib/stripe";

/**
 * Stripe tells us when someone pays, changes plan, misses a payment or cancels.
 * Signed with STRIPE_WEBHOOK_SECRET; anything unsigned is refused.
 */
export async function POST(request: Request) {
  const stripe = stripeClient();
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!stripe || !secret) return NextResponse.json({ error: "not configured" }, { status: 503 });

  const body = await request.text();
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, request.headers.get("stripe-signature") ?? "", secret);
  } catch {
    return NextResponse.json({ error: "bad signature" }, { status: 400 });
  }

  const db = createAdminClient();
  // Each event once.
  const { error: dupe } = await db.from("stripe_events").insert({ id: event.id, type: event.type });
  if (dupe) return NextResponse.json({ received: true, duplicate: true });

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const s = event.data.object as Stripe.Checkout.Session;
        const tenantId = s.client_reference_id ?? s.metadata?.tenant_id;
        // A top-up: add its quotes once it's paid (each checkout once).
        if (tenantId && s.mode === "payment" && s.metadata?.topup_quotes && s.payment_status === "paid") {
          const n = Number(s.metadata.topup_quotes);
          if (n > 0) {
            await db.rpc("add_quote_credits", { t: tenantId, n, sid: s.id, amount: (s.amount_total ?? 0) / 100 });
            await db.from("audit_log").insert({ tenant_id: tenantId, actor: null, action: "billing.topup", target: `${n} quotes ${s.id}` });
          }
        }
        if (tenantId && typeof s.subscription === "string") {
          const sub = await stripe.subscriptions.retrieve(s.subscription);
          await apply(db, tenantId, sub, typeof s.customer === "string" ? s.customer : null);
        }
        break;
      }
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted":
      case "customer.subscription.paused":
      case "customer.subscription.resumed": {
        const sub = event.data.object as Stripe.Subscription;
        const customer = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
        let tenantId = sub.metadata?.tenant_id ?? null;
        if (!tenantId) {
          const { data } = await db.from("tenants").select("id").eq("stripe_customer_id", customer).maybeSingle();
          tenantId = data?.id ?? null;
        }
        if (tenantId) await apply(db, tenantId, sub, customer);
        break;
      }
    }
  } catch (e) {
    // Let Stripe retry: forget we saw it.
    await db.from("stripe_events").delete().eq("id", event.id);
    return NextResponse.json({ error: e instanceof Error ? e.message : "failed" }, { status: 500 });
  }
  return NextResponse.json({ received: true });
}

async function apply(db: ReturnType<typeof createAdminClient>, tenantId: string, sub: Stripe.Subscription, customer: string | null) {
  const { data: t } = await db.from("tenants").select("id, status, past_due_since, stripe_subscription_id").eq("id", tenantId).maybeSingle();
  if (!t) return;
  // An older, replaced subscription ending shouldn't lock a company that has a newer one.
  if (t.stripe_subscription_id && t.stripe_subscription_id !== sub.id && sub.status === "canceled") return;
  const update: Record<string, unknown> = { ...tenantFromSubscription(sub, t) };
  if (customer) update.stripe_customer_id = customer;
  if (t.status === "setup" && (sub.status === "active" || sub.status === "trialing")) update.status = "live";
  await db.from("tenants").update(update).eq("id", tenantId);
  await db.from("audit_log").insert({ tenant_id: tenantId, actor: null, action: "billing.subscription", target: `${sub.id} ${sub.status}` });
}
