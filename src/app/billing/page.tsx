import Link from "next/link";
import { requireTenant } from "@/lib/tenant";
import { loadAccess } from "@/lib/access-load";
import { PLANS, PLAN_FEATURES, planFor } from "@/lib/plans";
import { PAID_PLANS } from "@/lib/stripe-keys";
import { signOut } from "@/app/actions";
import { Logo } from "../logo";
import { ManageBillingButton, PlanButton } from "./plan-buttons";

export const dynamic = "force-dynamic";


const STATUS: Record<string, string> = {
  active: "Paid up", trialing: "On trial", past_due: "Payment failed, retrying", unpaid: "Unpaid", canceled: "Cancelled",
  incomplete: "Waiting for payment", pending: "Waiting for payment", none: "Not paid yet",
};

/** Plan and billing. Also where people land when their trial or payments lapse. */
export default async function BillingPage({ searchParams }: { searchParams: Promise<{ paid?: string; cancelled?: string; start?: string }> }) {
  const ctx = await requireTenant();
  const q = await searchParams;
  const { tenant, access, trialQuotesUsed } = await loadAccess(ctx.tenant.id);
  const current = planFor(tenant.plan);
  const isAdmin = ctx.role === "admin";
  const paid = PAID_PLANS.includes(current.id as (typeof PAID_PLANS)[number]);
  const live = ["active", "trialing", "past_due"].includes(tenant.billing_status ?? "");
  const startPlan = q.start && PAID_PLANS.includes(q.start as (typeof PAID_PLANS)[number]) ? q.start : null;

  return (
    <div style={{ minHeight: "100vh" }}>
      <header style={{ background: "var(--bitumen)", padding: "14px clamp(16px, 4vw, 40px)", display: "flex", alignItems: "center", gap: 16 }}>
        <Logo size={24} dark />
        <span style={{ marginLeft: "auto" }} />
        {access.state === "ok" && <Link href="/quotes" style={{ color: "#f3f4f6", fontSize: 14 }}>Back to quotes</Link>}
        <form action={signOut}><button type="submit" style={{ background: "none", border: "1px solid #4a4f56", color: "#f3f4f6", borderRadius: 6, padding: "6px 10px", font: "inherit", fontSize: 13, cursor: "pointer" }}>Sign out</button></form>
      </header>

      <main style={{ padding: "32px clamp(16px, 4vw, 40px)" }}>
        <div className="page" style={{ maxWidth: 1000 }}>
          <div>
            <h1>Plan and billing</h1>
            <p className="sub">{ctx.tenant.name} · {current.name}{paid ? ` · ${STATUS[tenant.billing_status ?? "none"] ?? tenant.billing_status}` : ""}
              {current.id === "trial" && ` · ${trialQuotesUsed} of ${tenant.ai_quota_month ?? current.aiQuotes} trial quotes used`}</p>
          </div>

          {q.paid && <p className="card" style={{ background: "var(--good-bg)", borderColor: "var(--good)", margin: 0 }}>Thanks, payment received. Your plan switches on within a minute. <Link href="/setup" style={{ fontWeight: 600, textDecoration: "underline" }}>Go to Setup</Link></p>}
          {q.cancelled && <p className="card" style={{ margin: 0 }}>Payment wasn&apos;t finished. Pick a plan below whenever you&apos;re ready.</p>}
          {access.state === "locked" && !q.paid && (
            <p className="card" style={{ background: "var(--warn-bg)", borderColor: "#f0dba5", margin: 0, fontWeight: 600 }}>
              {access.message}{!isAdmin && " Ask your company's quoteout admin to sort it out."}
            </p>
          )}
          {access.state === "ok" && access.banner && <p className="card" style={{ background: "var(--warn-bg)", borderColor: "#f0dba5", margin: 0 }}>{access.banner}</p>}

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))", gap: 14 }}>
            {PAID_PLANS.map((id) => {
              const p = PLANS[id];
              const mine = current.id === id && live;
              const up = (p.priceMonthly ?? 0) > (paid && live ? current.priceMonthly ?? 0 : 0);
              return (
                <section key={id} className="card" style={{ display: "flex", flexDirection: "column", gap: 12, ...(mine ? { border: "2px solid var(--brand)" } : id === "pro" ? { borderColor: "#b6bcc4" } : {}) }}>
                  <div className="row" style={{ justifyContent: "space-between", gap: 8 }}>
                    <h2 style={{ margin: 0, fontSize: 20 }}>{p.name}</h2>
                    {mine ? <span className="badge good">Your plan</span> : id === "pro" ? <span className="badge quiet">Most popular</span> : null}
                  </div>
                  <div><span style={{ fontSize: 34, fontWeight: 700, letterSpacing: "-0.02em" }}>${p.priceMonthly}</span><span className="sub"> a month + GST</span></div>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>{p.aiQuotes} AI quotes a month</div>
                  <ul style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 4, fontSize: 14, flex: 1 }}>
                    {PLAN_FEATURES[id].map((f) => <li key={f}>{f}</li>)}
                  </ul>
                  {isAdmin && !mine && (
                    <PlanButton plan={id} primary={up || id === "pro"}
                      label={paid && live ? (up ? `Upgrade to ${p.name}` : `Switch to ${p.name}`) : `Choose ${p.name}`}
                      confirmText={paid && live ? `Confirm: $${p.priceMonthly}/mo + GST` : undefined}
                      autoStart={startPlan === id && !live} />
                  )}
                </section>
              );
            })}
          </div>

          <p className="sub" style={{ margin: 0, fontSize: 13 }}>
            Launch prices: sign up now and keep them. Every plan includes unlimited users and setup of your rates, plants and rules.
            Changing plan takes effect straight away; Stripe charges or credits the difference for the month. Cancel any time.
          </p>

          {isAdmin && tenant.stripe_customer_id && (
            <section className="card row" style={{ gap: 12 }}>
              <span className="grow">Update your card, download tax invoices or cancel, on Stripe&apos;s secure billing page.</span>
              <ManageBillingButton />
            </section>
          )}
        </div>
      </main>
    </div>
  );
}
