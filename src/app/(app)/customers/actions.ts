"use server";

import { revalidatePath } from "next/cache";
import { requireTenant } from "@/lib/tenant";
import { createClient } from "@/lib/supabase/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const val = (f: FormData, k: string, n: number) => String(f.get(k) ?? "").trim().slice(0, n) || null;
export type CustomerState = { ok: boolean; message: string } | null;

/** Add a customer, or change one's details. */
export async function saveCustomer(_: CustomerState, f: FormData): Promise<CustomerState> {
  const ctx = await requireTenant();
  if (ctx.role === "viewer") return { ok: false, message: "Viewers can't change customers." };
  const id = String(f.get("id") ?? "");
  const name = val(f, "name", 200);
  if (!name) return { ok: false, message: "Add the customer's name." };
  const email = val(f, "email", 200);
  if (email && !/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(email)) return { ok: false, message: "That email doesn't look right." };
  const row = { name, contact_name: val(f, "contact_name", 120), email, phone: val(f, "phone", 40), address: val(f, "address", 300), abn: val(f, "abn", 20), notes: val(f, "notes", 2000), updated_at: new Date().toISOString() };
  const db = await createClient();
  const { error } = id && UUID.test(id)
    ? await db.from("customers").update(row).eq("tenant_id", ctx.tenant.id).eq("id", id)
    : await db.from("customers").insert({ ...row, tenant_id: ctx.tenant.id });
  if (error) return { ok: false, message: error.code === "23505" ? "There's already a customer with that name." : error.message };
  revalidatePath("/customers");
  return { ok: true, message: "Saved." };
}
