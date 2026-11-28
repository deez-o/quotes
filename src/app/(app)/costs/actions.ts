"use server";

import { toCodes } from "@/lib/quote/placeholders";

import { revalidatePath } from "next/cache";
import { binderLabel, normaliseBinder } from "@/lib/binder";
import { redirect } from "next/navigation";
import { requireTenant } from "@/lib/tenant";
import { createClient } from "@/lib/supabase/server";
import { searchPlaces } from "@/lib/maps";

const CATEGORIES = ["crew", "material", "plant", "truck", "float", "other"] as const;
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
  const ordinary = num(formData.get("ordinary_hours"));
  const ot1h = num(formData.get("ot1_hours"));
  const ot1m = num(formData.get("ot1_multiplier"));
  const ot2m = num(formData.get("ot2_multiplier"));
  const minHours = num(formData.get("min_hours"));
  if (Number.isNaN(minHours) || (minHours != null && (minHours <= 0 || minHours > 24))) back("Minimum hire is hours a day, between 0 and 24.");
  const hourly = (category === "crew" || category === "plant") && unit === "h";
  if (hourly && ordinary != null) {
    if (Number.isNaN(ordinary) || ordinary <= 0 || ordinary > 24) back("Ordinary hours must be between 0 and 24.");
    if (Number.isNaN(ot1h) || (ot1h != null && (ot1h < 0 || ot1h > 24))) back("Time-and-a-half hours must be between 0 and 24.");
    if ([ot1m, ot2m].some((m) => Number.isNaN(m) || (m != null && (m < 1 || m > 5)))) back("Overtime rates are multiples of the hourly rate, e.g. 1.5 or 2.");
  }
  // Sliding scale: up to 5 price breaks, ascending.
  const tiers: { up_to: number; rate: number }[] = [];
  for (let i = 0; i < 5; i++) {
    const upTo = num(formData.get(`tier_up_to_${i}`));
    const r = num(formData.get(`tier_rate_${i}`));
    if (upTo == null && r == null) continue;
    if (upTo == null || r == null || Number.isNaN(upTo) || Number.isNaN(r) || upTo <= 0 || r < 0) back(`Each price break for ${name} needs an "up to" amount and a rate.`);
    tiers.push({ up_to: upTo as number, rate: r as number });
  }
  tiers.sort((a, b) => a.up_to - b.up_to);
  if (new Set(tiers.map((t) => t.up_to)).size !== tiers.length) back(`Two price breaks for ${name} have the same "up to" amount.`);
  const plantRaw = String(formData.get("supply_plant_id") ?? "");
  const supply_plant_id = category === "material" && /^[0-9a-f-]{36}$/i.test(plantRaw) ? plantRaw : null;

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
    min_hours: ["crew", "plant", "truck"].includes(category) ? minHours : null,
    truck_capacity_t: category === "truck" ? capacity ?? 12 : null, supply_plant_id, active: true, rate_tiers: tiers.length ? tiers : null,
    ordinary_hours: hourly ? ordinary : null, ot1_hours: hourly && ordinary ? ot1h ?? 2 : null,
    ot1_multiplier: hourly && ordinary ? ot1m ?? 1.5 : null, ot2_multiplier: hourly && ordinary ? ot2m ?? 2 : null, updated_at: new Date().toISOString(),
  };
  const { error } = id
    ? await supabase.from("cost_items").update(row).eq("id", id).eq("tenant_id", ctx.tenant.id)
    : await supabase.from("cost_items").insert(row);
  if (error) back(error.message.includes("duplicate") ? `You already have a cost called ${name}${supply_plant_id ? " at this plant" : ""}.` : error.message);
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

/** Address -> coordinates (Google if the maps key is set, else OpenStreetMap). */
async function geocode(address: string): Promise<{ lat: number; lng: number; source: "google" | "osm" } | null> {
  try {
    const [hit] = await searchPlaces(address, { apiKey: process.env.GOOGLE_MAPS_API_KEY || null });
    return hit ? { lat: hit.lat, lng: hit.lng, source: hit.source } : null;
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
  const src = String(formData.get("place_source") ?? "");
  let place_source: string | null = ["google", "osm", "entered"].includes(src) ? src : lat != null && lng != null ? "entered" : null;
  if ((lat == null || lng == null) && address) {
    const hit = await geocode(address);
    if (hit) ({ lat, lng, source: place_source } = hit);
  }
  const supabase = await createClient();
  const row = { tenant_id: ctx.tenant.id, name, address, lat, lng, place_source, active: true };
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
  const fields = ["truck_load_minutes", "truck_unload_minutes", "shift_minutes", "gst_percent"] as const;
  const values: Record<string, number> = {};
  // Shown in hours ("Truck working day"), stored in minutes.
  const hrs = num(formData.get("shift_hours"));
  if (hrs != null && !Number.isNaN(hrs)) formData.set("shift_minutes", String(Math.round(hrs * 60)));
  for (const f of fields) {
    const n = num(formData.get(f));
    if (n == null || Number.isNaN(n) || n < 0) back("Pricing settings must be numbers.");
    values[f] = n as number;
  }
  if (values.shift_minutes < 60) back("Check the truck working day: it should be at least 1 hour.");
  const binder = num(formData.get("binder_percent"));
  if (binder != null && !Number.isNaN(binder)) {
    if (binder <= 0 || binder >= 20) back("Binder content should be between 0 and 20%.");
    values.binder_percent = binder;
  }
  const supabase = await createClient();
  const { error } = await supabase.from("tenant_settings").upsert({
    tenant_id: ctx.tenant.id, ...values,
    quote_terms: toCodes(String(formData.get("quote_terms") ?? "").trim()).slice(0, 2000) || null,
    notify_drafts: formData.get("notify_drafts") === "on",
    quote_email_message: toCodes(String(formData.get("quote_email_message") ?? "").replace(/\r/g, "").trim()).slice(0, 4000) || null,
    updated_at: new Date().toISOString(),
  });
  if (error) back(error.message);
  revalidatePath("/costs");
  back("Pricing settings saved.", true);
}

/** A plant's base binder (what its mix prices include) and its binder extra-overs. */
export async function saveBinders(formData: FormData) {
  const ctx = await adminCtx();
  const plantId = String(formData.get("plant_id") ?? "");
  const supabase = await createClient();
  const { data: plant } = await supabase.from("supply_plants").select("id, name").eq("id", plantId).eq("tenant_id", ctx.tenant.id).maybeSingle();
  if (!plant) back("Plant not found.");
  const base = normaliseBinder(String(formData.get("base_binder") ?? "")) ?? "C320";
  await supabase.from("supply_plants").update({ base_binder: base }).eq("id", plantId).eq("tenant_id", ctx.tenant.id);

  // Rows come in as binder_0 / extra_0, binder_1 / extra_1 ... plus a blank "add" row.
  const rows = new Map<string, number>();
  for (let n = 0; n < 40; n++) {
    const b = normaliseBinder(String(formData.get(`binder_${n}`) ?? ""));
    const raw = formData.get(`extra_${n}`);
    if (!b || raw == null || String(raw).trim() === "") continue;
    const x = num(raw);
    if (x == null || Number.isNaN(x)) back(`Check the extra for ${binderLabel(b)}: it should be $ a tonne.`);
    if (b === base) continue; // the base binder has no extra
    rows.set(b, x as number);
  }
  await supabase.from("binder_extras").delete().eq("supply_plant_id", plantId).eq("tenant_id", ctx.tenant.id);
  if (rows.size) {
    const { error } = await supabase.from("binder_extras").insert([...rows].map(([binder, extra_per_t]) => ({ tenant_id: ctx.tenant.id, supply_plant_id: plantId, binder, extra_per_t })));
    if (error) back(error.message);
  }
  revalidatePath("/costs");
  back(`Saved binders at ${plant!.name}.`, true);
}
