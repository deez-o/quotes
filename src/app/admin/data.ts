import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { limitsFor, periodNow } from "@/lib/plans";
import { shareFlags, type DeviceRow } from "@/lib/devices";

export type Company = {
  id: string; name: string; slug: string; plan: string | null; status: string; created_at: string;
  ai_quota_month: number | null; max_devices: number | null; admin_note: string | null; trial_ends_at: string | null;
  billing_status: string | null; stripe_subscription_id: string | null; stripe_customer_id: string | null; past_due_since: string | null;
};

export type Person = { userId: string; email: string; tenantId: string; role: string; disabledAt: string | null; joined: string; lastSignIn: string | null };

/** Everything the admin overview needs, in a handful of queries. */
export async function loadAdmin(db: SupabaseClient) {
  const period = periodNow();
  const monthStart = `${period}-01T00:00:00+10:00`;
  const since30 = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();

  const [tenants, memberships, devices, usage, quotes, jobs, queue, badConnections, users] = await Promise.all([
    db.from("tenants").select("id, name, slug, plan, status, created_at, ai_quota_month, max_devices, admin_note, trial_ends_at, billing_status, stripe_subscription_id, stripe_customer_id, past_due_since").order("created_at"),
    db.from("memberships").select("tenant_id, user_id, role, created_at, disabled_at"),
    db.from("user_devices").select("id, user_id, tenant_id, device_id, label, session_id, city, region, country, last_seen, first_seen, revoked_at, revoked_reason, ip").gte("last_seen", since30).order("last_seen", { ascending: false }),
    db.from("usage_events").select("tenant_id, user_id, kind, qty, cost_usd").eq("period", period),
    db.from("site_quotes").select("tenant_id, created_by").gte("created_at", monthStart),
    db.from("jobs").select("tenant_id").gte("created_at", monthStart),
    db.from("queue_jobs").select("status, kind, created_at, last_error, tenant_id").in("status", ["queued", "running", "failed", "dead"]),
    db.from("connections").select("tenant_id, provider, status, last_error, last_ok_at").neq("status", "ok"),
    db.auth.admin.listUsers({ perPage: 1000 }),
  ]);

  const emailOf = new Map<string, { email: string; lastSignIn: string | null }>();
  for (const u of users.data?.users ?? []) emailOf.set(u.id, { email: u.email ?? "(no email)", lastSignIn: u.last_sign_in_at ?? null });

  const people: Person[] = (memberships.data ?? []).map((m) => ({
    userId: m.user_id, tenantId: m.tenant_id, role: m.role, disabledAt: m.disabled_at, joined: m.created_at,
    email: emailOf.get(m.user_id)?.email ?? m.user_id, lastSignIn: emailOf.get(m.user_id)?.lastSignIn ?? null,
  }));

  const deviceRows = (devices.data ?? []) as (DeviceRow & { tenant_id: string | null; revoked_reason: string | null; ip: string | null })[];
  const flags = shareFlags(deviceRows.filter((d) => !d.revoked_at));

  const companies = ((tenants.data ?? []) as Company[]).map((t) => {
    const lim = limitsFor(t);
    const aiUsed = (usage.data ?? []).filter((u) => u.tenant_id === t.id && u.kind === "ai_quote").reduce((n, u) => n + Number(u.qty), 0);
    const aiCalls = (usage.data ?? []).filter((u) => u.tenant_id === t.id).reduce((n, u) => n + Number(u.qty), 0);
    const aiCost = (usage.data ?? []).filter((u) => u.tenant_id === t.id).reduce((n, u) => n + Number(u.cost_usd ?? 0), 0);
    const members = people.filter((p) => p.tenantId === t.id);
    const tDevices = deviceRows.filter((d) => d.tenant_id === t.id);
    return {
      ...t, limits: lim, aiUsed, aiCalls, aiCost,
      people: members.length,
      quotesThisMonth: (quotes.data ?? []).filter((q) => q.tenant_id === t.id).length + (jobs.data ?? []).filter((j) => j.tenant_id === t.id).length,
      lastActive: tDevices[0]?.last_seen ?? null,
      flags: flags.filter((f) => members.some((m) => m.userId === f.userId)).length,
      problems: (badConnections.data ?? []).filter((c) => c.tenant_id === t.id).length + (queue.data ?? []).filter((q) => q.tenant_id === t.id && (q.status === "failed" || q.status === "dead")).length,
    };
  });

  const live = companies.filter((c) => c.status !== "paused" && (c.billing_status === "active" || c.billing_status === "past_due" || c.billing_status === "trialing"));
  return {
    period,
    companies,
    people,
    devices: deviceRows,
    flags: flags.map((f) => ({ ...f, person: people.find((p) => p.userId === f.userId) ?? null })),
    usage: usage.data ?? [],
    quotesByUser: (quotes.data ?? []).reduce((m, q) => m.set(q.created_by, (m.get(q.created_by) ?? 0) + 1), new Map<string, number>()),
    totals: {
      companies: companies.length,
      paying: live.filter((c) => (c.limits.plan.priceMonthly ?? 0) > 0).length,
      people: people.length,
      aiCalls: companies.reduce((n, c) => n + c.aiCalls, 0),
      aiCostUsd: companies.reduce((n, c) => n + c.aiCost, 0),
      monthlyRevenue: live.reduce((n, c) => n + (c.limits.plan.priceMonthly ?? 0), 0),
      activeToday: new Set(deviceRows.filter((d) => Date.now() - new Date(d.last_seen).getTime() < 24 * 3600 * 1000).map((d) => d.user_id)).size,
    },
    health: {
      queued: (queue.data ?? []).filter((q) => q.status === "queued").length,
      oldestQueued: (queue.data ?? []).filter((q) => q.status === "queued").map((q) => q.created_at).sort()[0] ?? null,
      stuck: (queue.data ?? []).some((q) => q.status === "queued" && Date.now() - new Date(q.created_at).getTime() > 10 * 60000),
      failed: (queue.data ?? []).filter((q) => q.status === "failed" || q.status === "dead"),
      badConnections: badConnections.data ?? [],
    },
  };
}

export function ago(iso: string | null) {
  if (!iso) return "never";
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 90) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 48 * 3600) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} days ago`;
}
