import "server-only";
import { requireTenant } from "@/lib/tenant";
import { createClient } from "@/lib/supabase/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A quote the signed-in person's company owns (RLS also enforces this), or null. */
export async function ownQuote<T = Record<string, unknown>>(id: string, columns: string) {
  if (!UUID.test(id)) return null;
  const ctx = await requireTenant();
  const db = await createClient();
  const { data } = await db.from("site_quotes").select(columns).eq("tenant_id", ctx.tenant.id).eq("id", id).maybeSingle();
  return data ? { ctx, db, quote: data as unknown as T } : null;
}
