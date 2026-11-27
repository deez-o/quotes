import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import type { LayeredRule } from "./rules";

const byNumber = (a: LayeredRule, b: LayeredRule) => (Number(a.code.replace(/\D/g, "")) || 0) - (Number(b.code.replace(/\D/g, "")) || 0);

/**
 * House rules (read with the service role: customers can't read them) and the tenant's own
 * active rules (read with the caller's client, so RLS applies). If the service role isn't set
 * up yet, quotes run on the customer's rules alone.
 */
export async function loadLayeredRules(db: SupabaseClient, tenantId: string, module = "quoting"): Promise<{ house: LayeredRule[]; own: LayeredRule[] }> {
  let house: LayeredRule[] = [];
  try {
    const { data } = await createAdminClient().from("starter_rules").select("code, grp, text").eq("module", module);
    house = ((data ?? []) as LayeredRule[]).sort(byNumber);
  } catch {
    house = [];
  }
  const { data: mine } = await db.from("rules").select("code, grp, text")
    .eq("tenant_id", tenantId).eq("module", module).eq("status", "active").neq("source", "starter");
  return { house, own: ((mine ?? []) as LayeredRule[]).map((r) => ({ ...r, grp: null })).sort(byNumber) };
}
