"use server";

import { revalidatePath } from "next/cache";
import { requireTenant } from "@/lib/tenant";
import { createClient } from "@/lib/supabase/server";
import { isHex } from "@/lib/branding";

const t = (f: FormData, k: string, max = 200) => {
  const v = String(f.get(k) ?? "").trim().slice(0, max);
  return v || null;
};

export async function saveBranding(formData: FormData): Promise<{ ok: boolean; message: string }> {
  const ctx = await requireTenant();
  if (ctx.role !== "admin") return { ok: false, message: "Only a client admin can change the branding." };
  const color = String(formData.get("brand_color") ?? "").trim();
  if (color && !isHex(color)) return { ok: false, message: "Pick a colour from the list or the colour picker." };
  const logo = String(formData.get("logo_path") ?? "").trim();
  if (logo && (!logo.startsWith(`${ctx.tenant.id}/uploads/branding/`) || logo.includes(".."))) return { ok: false, message: "That logo upload didn't work. Try again." };
  const email = t(formData, "business_email");
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, message: "Check the email address." };

  const db = await createClient();
  const { error } = await db.from("tenant_settings").upsert({
    tenant_id: ctx.tenant.id,
    logo_path: logo || null,
    brand_color: color ? color.toUpperCase() : null,
    business_name: t(formData, "business_name"),
    business_abn: t(formData, "business_abn", 30),
    state: ["QLD", "NSW", "VIC", "SA", "WA", "TAS", "NT", "ACT"].includes(String(formData.get("state"))) ? String(formData.get("state")) : null,
    business_phone: t(formData, "business_phone", 40),
    business_email: email,
    business_address: t(formData, "business_address", 300),
    business_website: t(formData, "business_website", 120),
    updated_at: new Date().toISOString(),
  }, { onConflict: "tenant_id" });
  if (error) return { ok: false, message: error.message };
  revalidatePath("/setup");
  return { ok: true, message: "Branding saved. Your printed quotes and PDFs use it now." };
}
