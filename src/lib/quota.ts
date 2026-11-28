import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { limitsFor, periodNow, planFor, QUOTE_KINDS, TOPUP } from "@/lib/plans";

export type Allowance = { cap: number | null; used: number; credits: number; left: number | null };

/** This month's quotes: the plan's allowance, how many are used, and top-up credits on top. */
export async function allowance(tenantId: string): Promise<Allowance> {
  const db = createAdminClient();
  const { data: t } = await db.from("tenants").select("plan, ai_quota_month, max_devices, quote_credits").eq("id", tenantId).single();
  const lim = limitsFor({ plan: (t?.plan as string) ?? null, ai_quota_month: (t?.ai_quota_month as number | null) ?? null, max_devices: null });
  const trial = planFor(t?.plan as string).id === "trial";
  let q = db.from("usage_events").select("qty").eq("tenant_id", tenantId).in("kind", QUOTE_KINDS);
  if (!trial) q = q.eq("period", periodNow());
  const { data: rows } = await q;
  const used = (rows ?? []).reduce((n, r) => n + Number(r.qty ?? 1), 0);
  const credits = Number(t?.quote_credits ?? 0);
  const cap = lim.aiQuotes;
  return { cap, used, credits, left: cap == null ? null : Math.max(0, cap - used) + credits };
}

/**
 * Use one quote: from the month's allowance, else a top-up credit. Counted as a usage event.
 * Refused (with a message to show) when both are gone.
 */
export async function takeQuote(tenantId: string, userId: string | null, kind: "quote_drafted" | "ai_quote"): Promise<{ ok: true } | { ok: false; message: string }> {
  const a = await allowance(tenantId);
  const db = createAdminClient();
  if (a.cap != null && a.used >= a.cap) {
    const { data: took } = await db.rpc("take_quote_credit", { t: tenantId });
    if (!took) return { ok: false, message: `You've used all ${a.cap} quotes this month. Top up ${TOPUP.quotes} quotes for $${TOPUP.priceAud}, or move up a plan, then read it again.` };
  }
  if (kind === "quote_drafted") {
    await db.from("usage_events").insert({ tenant_id: tenantId, user_id: userId, module: "quoting", kind, qty: 1, cost_usd: 0, period: periodNow() });
  }
  return { ok: true };
}
