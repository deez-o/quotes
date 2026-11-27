/**
 * Can this company use quoteout right now? Pure: give it the company and its usage.
 *
 *  - Trial: 14 days or its AI quote allowance, whichever runs out first. Then locked until they pick a plan.
 *  - Paid plan: works while Stripe says active. A failed payment gets 7 days' grace with a warning,
 *    then it locks. Cancelled, or never paid, is locked.
 *  - Pilot: always on.
 * Locked never deletes anything: their quotes and setup are kept for when they pay.
 */
import { planFor } from "@/lib/plans";

export const GRACE_DAYS = 7;

export type AccessInput = {
  plan: string | null;
  billing_status: string | null;
  trial_ends_at: string | null;
  past_due_since: string | null;
  ai_quota_month: number | null;
};

export type Access =
  | { state: "ok"; banner?: string }
  | { state: "locked"; reason: "trial_over" | "unpaid" | "canceled" | "not_paid"; message: string };

const DAY = 24 * 3600 * 1000;

export function accessFor(t: AccessInput, trialQuotesUsed: number, now = new Date()): Access {
  const plan = planFor(t.plan);
  if (plan.id === "pilot") return { state: "ok" };

  if (plan.id === "trial") {
    const ends = t.trial_ends_at ? new Date(t.trial_ends_at).getTime() : null;
    const cap = t.ai_quota_month ?? plan.aiQuotes ?? Infinity;
    const daysLeft = ends == null ? null : Math.ceil((ends - now.getTime()) / DAY);
    if ((daysLeft != null && daysLeft <= 0) || trialQuotesUsed >= cap) {
      return { state: "locked", reason: "trial_over", message: "Your free trial has finished. Pick a plan to keep quoting. Everything you've set up is saved." };
    }
    const left = Number.isFinite(cap) ? cap - trialQuotesUsed : null;
    const bits = [daysLeft != null ? `${daysLeft} day${daysLeft === 1 ? "" : "s"}` : null, left != null ? `${left} AI quote${left === 1 ? "" : "s"}` : null].filter(Boolean);
    return { state: "ok", banner: `Free trial: ${bits.join(" or ")} left.` };
  }

  // Paid plans follow Stripe.
  switch (t.billing_status) {
    case "active":
    case "trialing":
      return { state: "ok" };
    case "past_due": {
      const since = t.past_due_since ? new Date(t.past_due_since).getTime() : now.getTime();
      const left = Math.ceil((since + GRACE_DAYS * DAY - now.getTime()) / DAY);
      if (left > 0) return { state: "ok", banner: `Your last payment didn't go through. Update your card within ${left} day${left === 1 ? "" : "s"} to keep using quoteout.` };
      return { state: "locked", reason: "unpaid", message: "Your payment didn't go through, so quoteout is on hold. Update your card to carry on. Everything is saved." };
    }
    case "unpaid":
      return { state: "locked", reason: "unpaid", message: "Your payment didn't go through, so quoteout is on hold. Update your card to carry on. Everything is saved." };
    case "canceled":
    case "incomplete_expired":
    case "paused":
      return { state: "locked", reason: "canceled", message: "Your subscription has ended. Pick a plan to start quoting again. Everything is saved." };
    default:
      return { state: "locked", reason: "not_paid", message: "Finish paying for your plan to start quoting." };
  }
}
