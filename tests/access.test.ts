import { describe, expect, it } from "vitest";
import { accessFor, type AccessInput } from "@/lib/access";
import { planFromLookupKey } from "@/lib/stripe-keys";

const now = new Date("2026-11-27T10:00:00Z");
const t = (o: Partial<AccessInput>): AccessInput => ({ plan: "trial", billing_status: "none", trial_ends_at: "2026-12-05T10:00:00Z", past_due_since: null, ai_quota_month: null, ...o });

describe("who can use quoteout", () => {
  it("lets a trial run, with a countdown", () => {
    const a = accessFor(t({}), 3, now);
    expect(a.state).toBe("ok");
    expect(a.state === "ok" && a.banner).toMatch(/8 days or 12 AI quotes left/);
  });
  it("locks a trial when the days run out", () => {
    expect(accessFor(t({ trial_ends_at: "2026-11-27T09:00:00Z" }), 0, now)).toMatchObject({ state: "locked", reason: "trial_over" });
  });
  it("locks a trial when its AI quotes run out", () => {
    expect(accessFor(t({}), 15, now)).toMatchObject({ state: "locked", reason: "trial_over" });
    expect(accessFor(t({ ai_quota_month: 30 }), 15, now).state).toBe("ok");
  });
  it("paid plans follow Stripe", () => {
    expect(accessFor(t({ plan: "pro", billing_status: "active" }), 0, now).state).toBe("ok");
    expect(accessFor(t({ plan: "pro", billing_status: "pending" }), 0, now)).toMatchObject({ state: "locked", reason: "not_paid" });
    expect(accessFor(t({ plan: "pro", billing_status: "canceled" }), 0, now)).toMatchObject({ state: "locked", reason: "canceled" });
  });
  it("gives 7 days' grace after a failed payment, then locks", () => {
    const soon = accessFor(t({ plan: "site", billing_status: "past_due", past_due_since: "2026-11-25T10:00:00Z" }), 0, now);
    expect(soon.state).toBe("ok");
    expect(soon.state === "ok" && soon.banner).toMatch(/5 days/);
    expect(accessFor(t({ plan: "site", billing_status: "past_due", past_due_since: "2026-11-19T10:00:00Z" }), 0, now)).toMatchObject({ state: "locked", reason: "unpaid" });
  });
  it("never locks the free pilot", () => {
    expect(accessFor(t({ plan: "pilot", billing_status: "none", trial_ends_at: null }), 999, now).state).toBe("ok");
  });
});

describe("Stripe prices", () => {
  it("reads the plan from a price's lookup key", () => {
    expect(planFromLookupKey("quoteout_pro_monthly_v1")).toBe("pro");
    expect(planFromLookupKey("quoteout_business_monthly_v2")).toBe("business");
    expect(planFromLookupKey("something_else")).toBeNull();
  });
});
