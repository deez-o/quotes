import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PlanId } from "@/lib/plans";

export const TRIAL_DAYS = 14;

/** Forwarding-address-safe name, e.g. "Smith & Sons Asphalt" -> "smith-and-sons-asphalt". */
export function slugFor(name: string) {
  return name.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "company";
}

/** A new customer company with its own RFQ forwarding address (<slug>@in.quoteout.app). */
export async function createTenant(db: SupabaseClient, name: string, plan: PlanId): Promise<{ ok: true; id: string; slug: string } | { ok: false; message: string }> {
  const base = slugFor(name);
  let slug = base;
  for (let i = 2; i < 50; i++) {
    const [{ data: t }, { data: a }] = await Promise.all([
      db.from("tenants").select("id").eq("slug", slug).maybeSingle(),
      db.from("inbound_addresses").select("local_part").eq("local_part", slug).maybeSingle(),
    ]);
    if (!t && !a) break;
    slug = `${base}-${i}`;
  }
  const trialEnds = plan === "trial" ? new Date(Date.now() + TRIAL_DAYS * 24 * 3600 * 1000).toISOString() : null;
  const { data: tenant, error } = await db.from("tenants")
    .insert({ name, slug, plan, status: "setup", file_storage: "app", trial_ends_at: trialEnds }).select("id").single();
  if (error || !tenant) return { ok: false, message: error?.message ?? "Couldn't create the company." };
  const id = tenant.id as string;
  await db.from("tenant_modules").insert({ tenant_id: id, module: "quoting", enabled: true });
  await db.from("tenant_settings").insert({ tenant_id: id });
  // Starter rate they can change in Your costs: tack coat goes under asphalt by default.
  await db.from("cost_items").insert({ tenant_id: id, name: "Tack coat", category: "material", material_kind: "tack", unit: "m2", rate: 2, sell_rate: 3, active: true });
  await db.from("inbound_addresses").insert({ local_part: slug, tenant_id: id });
  return { ok: true, id, slug };
}
