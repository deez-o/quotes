"use server";

import { revalidatePath } from "next/cache";
import { requireTenant } from "@/lib/tenant";
import { createClient } from "@/lib/supabase/server";

export type SaveState = { ok: boolean; message: string };

function num(formData: FormData, name: string): number | null | "bad" {
  const raw = String(formData.get(name) ?? "").replace(/[$,%\s]/g, "");
  if (raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : "bad";
}

function text(formData: FormData, name: string): string | null {
  const v = String(formData.get(name) ?? "").trim();
  return v === "" ? null : v.slice(0, 500);
}

export async function saveSettings(_prev: SaveState, formData: FormData): Promise<SaveState> {
  const ctx = await requireTenant();
  if (ctx.role !== "admin") return { ok: false, message: "Only a client admin can change settings." };

  const marginMode = String(formData.get("margin_mode") ?? "none");
  if (!["none", "per_shift", "percent"].includes(marginMode)) {
    return { ok: false, message: "Pick a margin target option." };
  }

  const numbers = {
    margin_per_shift: num(formData, "margin_per_shift"),
    margin_percent: num(formData, "margin_percent"),
    spray_markup_percent: num(formData, "spray_markup_percent"),
    extra_establishment_rate: num(formData, "extra_establishment_rate"),
    change_tolerance_percent: num(formData, "change_tolerance_percent"),
  };
  const bad = Object.entries(numbers).find(([, v]) => v === "bad");
  if (bad) return { ok: false, message: "Numbers only, please (no letters or negative values)." };

  if (marginMode === "per_shift" && numbers.margin_per_shift === null) {
    return { ok: false, message: "Enter the margin per asphalt shift, or choose another option." };
  }
  if (marginMode === "percent") {
    if (numbers.margin_percent === null) return { ok: false, message: "Enter the margin %, or choose another option." };
    if ((numbers.margin_percent as number) > 100) return { ok: false, message: "Margin % must be 100 or less." };
  }
  for (const key of ["spray_markup_percent", "change_tolerance_percent"] as const) {
    if (typeof numbers[key] === "number" && (numbers[key] as number) > 100) {
      return { ok: false, message: "Percentages must be 100 or less." };
    }
  }

  const supabase = await createClient();
  const { error } = await supabase.from("tenant_settings").upsert({
    tenant_id: ctx.tenant.id,
    margin_mode: marginMode,
    margin_per_shift: marginMode === "per_shift" ? numbers.margin_per_shift : null,
    margin_percent: marginMode === "percent" ? numbers.margin_percent : null,
    whole_dollar_rates: formData.get("whole_dollar_rates") === "on",
    default_binder: text(formData, "default_binder"),
    default_prime: text(formData, "default_prime"),
    spray_markup_percent: numbers.spray_markup_percent,
    extra_establishment_rate: numbers.extra_establishment_rate,
    change_tolerance_percent: numbers.change_tolerance_percent ?? 5,
    updated_at: new Date().toISOString(),
  });

  if (error) return { ok: false, message: `Couldn't save: ${error.message}` };
  revalidatePath("/settings");
  revalidatePath("/setup");
  return { ok: true, message: "Saved." };
}
