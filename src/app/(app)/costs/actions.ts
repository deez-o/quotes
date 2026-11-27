"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireTenant } from "@/lib/tenant";
import { createClient } from "@/lib/supabase/server";

const CATEGORIES = ["crew", "material", "plant", "truck", "other"] as const;
const KINDS = ["asphalt", "base", "prime", "seal", "other"] as const;
const UNITS = ["shift", "day", "h", "t", "m2", "m3", "each", "km"] as const;

function num(v: FormDataEntryValue | null): number | null {
  const s = String(v ?? "").replace(/[$,\s]/g, "");
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}
const back = (msg: string, ok = false): never => redirect(`/costs?${ok ? "saved" : "error"}=${encodeURIComponent(msg)}`);

async function adminCtx() {
  const ctx = await requireTenant();
  if (ctx.role !== "admin") back("Only a client admin can change costs.");
  return ctx;
}

export async function saveCostItem(formData: FormData) {
  const ctx = await adminCtx();
  const id = String(formData.get("id") ?? "") || null;
  const name = String(formData.get("name") ?? "").trim().slice(0, 120);
  const category = String(formData.get("category") ?? "");
  const unit = String(formData.get("unit") ?? "");
  const kindRaw = String(formData.get("material_kind") ?? "");
  const rate = num(formData.get("rate"));
  const density = num(formData.get("density_t_per_m3"));
  const capacity = num(formData.get("truck_capacity_t"));

  if (!name) back("Give the cost a name.");
  if (!CATEGORIES.includes(category as (typeof CATEGORIES)[number])) back("Pick a type.");
  if (!UNITS.includes(unit as (typeof UNITS)[number])) back("Pick a unit.");
  if (rate == null || Number.isNaN(rate) || rate < 0) back(`Enter a rate for ${name} (numbers only).`);
  if (Number.isNaN(density) || (density != null && density <= 0)) back("Density must be a positive number (t/m³).");
  if (Number.isNaN(capacity) || (capacity != null && capacity <= 0)) back("Truck capacity must be a positive number (t).");
  const material_kind = category === "material" && KINDS.includes(kindRaw as (typeof KINDS)[number]) ? kindRaw : null;
  if (category === "material" && unit === "t" && (material_kind === "asphalt" || material_kind === "base") && !density) {
    back(`${name} is sold by the tonne, so it needs a density (e.g. 2.4 for asphalt, 2.2 for crushed rock).`);
  }

  const supabase = await createClient();
  const row = {
    tenant_id: ctx.tenant.id, name, category, unit, rate, material_kind,
    density_t_per_m3: density, includes_delivery: formData.get("includes_delivery") === "on",
    truck_capacity_t: category === "truck" ? capacity ?? 12 : null, active: true, updated_at: new Date().toISOString(),
  };
  const { error } = id
    ? await supabase.from("cost_items").update(row).eq("id", id).eq("tenant_id", ctx.tenant.id)
    : await supabase.from("cost_items").insert(row);
  if (error) back(error.message.includes("duplicate") ? `You already have a cost called ${name}.` : error.message);
  revalidatePath("/costs");
  back(`Saved ${name}.`, true);
}

export async function archiveCostItem(formData: FormData) {
  const ctx = await adminCtx();
  const supabase = await createClient();
  await supabase.from("cost_items").update({ active: false, updated_at: new Date().toISOString() })
    .eq("id", String(formData.get("id"))).eq("tenant_id", ctx.tenant.id);
  revalidatePath("/costs");
  back("Removed. Old quotes keep their prices.", true);
}

/** Address -> coordinates via OpenStreetMap (light use, on save only). */
async function geocode(address: string): Promise<{ lat: number; lng: number } | null> {
  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=au&q=${encodeURIComponent(address)}`;
    const res = await fetch(url, { headers: { "User-Agent": "QUOTES estimating app (plant locations)" }, cache: "no-store" });
    if (!res.ok) return null;
    const hits = (await res.json()) as { lat: string; lon: string }[];
    return hits[0] ? { lat: Number(hits[0].lat), lng: Number(hits[0].lon) } : null;
  } catch {
    return null;
  }
}

export async function savePlant(formData: FormData) {
  const ctx = await adminCtx();
  const id = String(formData.get("id") ?? "") || null;
  const name = String(formData.get("name") ?? "").trim().slice(0, 120);
  const address = String(formData.get("address") ?? "").trim().slice(0, 300) || null;
  let lat = num(formData.get("lat"));
  let lng = num(formData.get("lng"));
  if (!name) back("Give the plant a name.");
  if (Number.isNaN(lat) || Number.isNaN(lng)) back("Latitude and longitude must be numbers.");
  if ((lat == null || lng == null) && address) {
    const hit = await geocode(address);
    if (hit) ({ lat, lng } = hit);
  }
  const supabase = await createClient();
  const row = { tenant_id: ctx.tenant.id, name, address, lat, lng, active: true };
  const { error } = id
    ? await supabase.from("supply_plants").update(row).eq("id", id).eq("tenant_id", ctx.tenant.id)
    : await supabase.from("supply_plants").insert(row);
  if (error) back(error.message);
  revalidatePath("/costs");
  back(lat == null ? `Saved ${name}, but couldn't find it on the map. Add its latitude and longitude.` : `Saved ${name}.`, lat != null);
}

export async function archivePlant(formData: FormData) {
  const ctx = await adminCtx();
  const supabase = await createClient();
  await supabase.from("supply_plants").update({ active: false }).eq("id", String(formData.get("id"))).eq("tenant_id", ctx.tenant.id);
  revalidatePath("/costs");
  back("Plant removed.", true);
}

export async function savePricingSettings(formData: FormData) {
  const ctx = await adminCtx();
  const fields = ["margin_percent", "truck_load_minutes", "truck_unload_minutes", "shift_minutes", "road_factor", "average_speed_kmh", "gst_percent"] as const;
  const values: Record<string, number> = {};
  for (const f of fields) {
    const n = num(formData.get(f));
    if (n == null || Number.isNaN(n) || n < 0) back("Pricing settings must be numbers.");
    values[f] = n as number;
  }
  if (values.margin_percent >= 95) back("Margin must be under 95%.");
  if (values.shift_minutes < 60 || values.average_speed_kmh < 5 || values.road_factor < 1) back("Check the shift length, speed and road factor.");
  const supabase = await createClient();
  const { error } = await supabase.from("tenant_settings").upsert({
    tenant_id: ctx.tenant.id, ...values,
    quote_terms: String(formData.get("quote_terms") ?? "").trim().slice(0, 2000) || null,
    updated_at: new Date().toISOString(),
  });
  if (error) back(error.message);
  revalidatePath("/costs");
  back("Pricing settings saved.", true);
}
