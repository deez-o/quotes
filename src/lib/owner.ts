import "server-only";
import { cache } from "react";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

/** quoteout staff only. Anyone else gets a plain 404, so the admin area isn't even visible. */
export const requireOwner = cache(async function requireOwner() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (!userId) notFound();
  const db = createAdminClient();
  const { data: row } = await db.from("platform_admins").select("user_id").eq("user_id", userId).maybeSingle();
  if (!row) notFound();
  return { userId: String(userId), email: (data.claims.email as string | undefined) ?? null, db };
});

/** Whether the signed-in person is quoteout staff (for showing the Admin link). Never throws. */
export async function isOwner(userId: string) {
  try {
    const { data } = await createAdminClient().from("platform_admins").select("user_id").eq("user_id", userId).maybeSingle();
    return Boolean(data);
  } catch {
    return false;
  }
}
