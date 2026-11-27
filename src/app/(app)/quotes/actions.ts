"use server";

import { revalidatePath } from "next/cache";
import { requireTenant } from "@/lib/tenant";
import { createClient } from "@/lib/supabase/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Delete a quote for good: a site quote with its photos, or an RFQ job with its files. */
export async function deleteQuote(input: { kind: "site" | "rfq"; id: string }): Promise<{ ok: boolean; message?: string }> {
  const ctx = await requireTenant();
  if (ctx.role === "viewer") return { ok: false, message: "You can view quotes but not delete them." };
  if (!UUID.test(input.id) || (input.kind !== "site" && input.kind !== "rfq")) return { ok: false, message: "Quote not found." };
  const db = await createClient();
  const t = ctx.tenant.id;

  let paths: string[] = [];
  if (input.kind === "site") {
    const { data } = await db.from("site_quotes").select("photos").eq("id", input.id).eq("tenant_id", t).maybeSingle();
    if (!data) return { ok: false, message: "Quote not found." };
    paths = ((data.photos ?? []) as string[]).filter((p) => p.startsWith(`${t}/`));
    const { error } = await db.from("site_quotes").delete().eq("id", input.id).eq("tenant_id", t);
    if (error) return { ok: false, message: error.message };
  } else {
    const { data: files } = await db.from("attachments").select("storage_path").eq("job_id", input.id).eq("tenant_id", t);
    paths = (files ?? []).map((f) => f.storage_path as string).filter((p) => p?.startsWith(`${t}/`));
    const { error, count } = await db.from("jobs").delete({ count: "exact" }).eq("id", input.id).eq("tenant_id", t);
    if (error) return { ok: false, message: error.message };
    if (!count) return { ok: false, message: "Quote not found, or you can't delete it." };
  }
  if (paths.length) await db.storage.from("job-files").remove(paths.slice(0, 500));
  revalidatePath("/quotes");
  return { ok: true };
}
