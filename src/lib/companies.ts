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
  // A full set of starter rates (see STARTER_COSTS): they change them in Your costs.
  await db.from("cost_items").insert(STARTER_COSTS.map((c) => ({ ...c, tenant_id: id, active: true })));
  await db.from("inbound_addresses").insert({ local_part: slug, tenant_id: id });
  return { ok: true, id, slug };
}

/**
 * Every new company starts with a full set of rates so a quote prices straight away; they go
 * through Your costs and change them. Their supply plants and mix prices are theirs to add.
 */
export const STARTER_COSTS: Record<string, unknown>[] = [
  { name: "Crew (per shift)", category: "crew", unit: "shift", rate: 10500 },
  { name: "Crew, long haul 14 h (per shift)", category: "crew", unit: "shift", rate: 12500 },
  { name: "Small crew, 6 people (per shift)", category: "crew", unit: "shift", rate: 4500 },
  { name: "Truck and driver", category: "truck", unit: "h", rate: 150, min_hours: 6, truck_capacity_t: 12 },
  { name: "Float", category: "float", unit: "each", rate: 500 },
  { name: "Establishment", category: "establishment", unit: "each", rate: 9000 },
  { name: "Prime (K2)", category: "material", material_kind: "prime", unit: "m2", rate: 2 },
  { name: "Tack coat", category: "material", material_kind: "tack", unit: "m2", rate: 2, sell_rate: 3 },
  { name: "Seal (C170, 14 mm)", category: "material", material_kind: "seal", unit: "m2", rate: 5 },
  { name: "Bobcat", category: "plant", unit: "h", rate: 150, min_hours: 6 },
  { name: "Profiler", category: "plant", unit: "h", rate: 450, min_hours: 6 },
  { name: "MTV / shuttle buggy (day shift)", category: "plant", unit: "day", rate: 6000 },
  { name: "MTV / shuttle buggy (night shift)", category: "plant", unit: "day", rate: 8000 },
];
