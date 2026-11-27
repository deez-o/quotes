"use server";

import { revalidatePath } from "next/cache";
import { requireTenant } from "@/lib/tenant";
import { createClient } from "@/lib/supabase/server";

/**
 * Save a new plain-English rule. It applies to quotes straight away and wins over the
 * house method where they conflict. Rules the app learns itself still arrive as "proposed".
 */
export async function addRule(formData: FormData) {
  const text = String(formData.get("text") ?? "").trim();
  if (text.length < 5) return;

  const ctx = await requireTenant();
  if (ctx.role === "viewer") return;
  const supabase = await createClient();

  const { data: codes } = await supabase
    .from("rules")
    .select("code")
    .eq("tenant_id", ctx.tenant.id)
    .eq("module", "quoting")
    .neq("source", "starter");
  const highest = (codes ?? [])
    .map((r) => Number(String(r.code).replace(/\D/g, "")))
    .filter((n) => Number.isFinite(n))
    .reduce((a, b) => Math.max(a, b), 0);

  await supabase.from("rules").insert({
    tenant_id: ctx.tenant.id,
    module: "quoting",
    code: `R${highest + 1}`,
    text: text.slice(0, 2000),
    status: "active",
    source: "manual",
    approved_by: ctx.userId,
  });

  revalidatePath("/teach");
}

/** Approve, switch off or reject a rule. Admins only (enforced by the database too). */
export async function setRuleStatus(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const status = String(formData.get("status") ?? "");
  if (!id || !["active", "off", "rejected"].includes(status)) return;

  const ctx = await requireTenant();
  if (ctx.role !== "admin") return;
  const supabase = await createClient();

  await supabase
    .from("rules")
    .update({
      status,
      approved_by: status === "active" ? ctx.userId : null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("tenant_id", ctx.tenant.id)
    .eq("always_on", false);

  revalidatePath("/teach");
}
