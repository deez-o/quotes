"use server";

import { revalidatePath } from "next/cache";
import { binderLabel, normaliseBinder } from "@/lib/binder";
import { requireTenant } from "@/lib/tenant";
import { createClient } from "@/lib/supabase/server";
import { aiCaller } from "@/lib/ai/call";
import { loadPricingContext } from "@/lib/site/load";
import { PRICE_LIST_SCHEMA, matchToLibrary, pdfText, readPriceList, type PriceListRead } from "@/lib/site/price-list";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Fail = { ok: false; message: string };

async function adminFor(plantId: string) {
  const ctx = await requireTenant();
  if (ctx.role !== "admin") throw new Error("Only a client admin can change costs.");
  if (!UUID.test(plantId)) throw new Error("Pick a plant first.");
  const db = await createClient();
  const { data: plant } = await db.from("supply_plants").select("id, name").eq("id", plantId).eq("tenant_id", ctx.tenant.id).eq("active", true).maybeSingle();
  if (!plant) throw new Error("Plant not found.");
  return { ctx, db, plant: plant as { id: string; name: string } };
}

/** Read an uploaded price list (PDF, photo or screenshot). Nothing is saved: the user checks the rows first. */
export async function readPriceListFile(input: { plantId: string; paths: string[] }): Promise<{ ok: true; read: PriceListRead; matches: (string | null)[] } | Fail> {
  try {
    const { ctx, db, plant } = await adminFor(input.plantId);
    const call = await aiCaller(PRICE_LIST_SCHEMA, ctx.tenant.id, ctx.userId, "ai_price_list");
    if (!call) return { ok: false, message: "Reading price lists needs the AI switched on (no AI key on the server yet). Type the prices in below instead." };
    const paths = input.paths.filter((p) => typeof p === "string" && p.startsWith(`${ctx.tenant.id}/uploads/pricelist-`) && !p.includes("..")).slice(0, 6);
    if (!paths.length) return { ok: false, message: "Add a PDF, photo or screenshot of the price list." };

    const texts: string[] = [];
    const imageUrls: string[] = [];
    for (const p of paths) {
      if (/\.pdf$/i.test(p)) {
        const { data, error } = await db.storage.from("job-files").download(p);
        if (error || !data) return { ok: false, message: `Couldn't open ${p.split("/").pop()}.` };
        const text = await pdfText(new Uint8Array(await data.arrayBuffer()));
        if (text.length < 20) return { ok: false, message: `${p.split("/").pop()} is a scanned PDF with no text. Take a screenshot or photo of it and upload that instead.` };
        texts.push(text);
      } else {
        const { data } = await db.storage.from("job-files").createSignedUrl(p, 600);
        if (data?.signedUrl) imageUrls.push(data.signedUrl);
      }
    }

    const pc = await loadPricingContext(db, ctx.tenant.id);
    const existingNames = [...new Set(pc.library.filter((c) => c.active && c.category === "material").map((c) => c.name))];
    const read = await readPriceList(
      call,
      { plantName: plant.name, text: texts.join("\n\n---\n\n") || null, imageUrls, existingNames },
    );
    if (!read.lines.length && !read.binder_extras.length) return { ok: false, message: "Couldn't find any prices in that. Try a clearer photo, or type them in below." };
    return { ok: true, read, matches: matchToLibrary(read.lines, pc.library, plant.id) };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Couldn't read the price list." };
  }
}

export type ImportLine = { name: string; unit: string; rate: number; kind: string; density: number | null; existingId: string | null };

const UNITS = new Set(["t", "m2", "m3", "each", "h", "day", "km"]);
const KINDS = new Set(["asphalt", "base", "prime", "tack", "seal", "other"]);

/** Save the rows the user ticked: update prices that exist at this plant, add the rest. */
export async function importPriceList(input: { plantId: string; lines: ImportLine[]; validUntil: string | null; supplier: string | null; baseBinder?: string | null; binderExtras?: { binder: string; extra_per_t: number }[] }): Promise<{ ok: true; updated: number; added: number; binders: number } | Fail> {
  try {
    const { ctx, db, plant } = await adminFor(input.plantId);
    const lines = (input.lines ?? []).slice(0, 200);
    const extras = (input.binderExtras ?? []).slice(0, 40);
    if (!lines.length && !extras.length) return { ok: false, message: "Tick at least one row to import." };
    const { data: current } = await db.from("cost_items").select("id, name").eq("tenant_id", ctx.tenant.id).eq("supply_plant_id", plant.id).eq("active", true);
    const byName = new Map((current ?? []).map((c) => [String(c.name).toLowerCase(), c.id as string]));
    const ids = new Set((current ?? []).map((c) => c.id as string));
    let updated = 0, added = 0;
    const now = new Date().toISOString();

    for (const l of lines) {
      const name = String(l.name ?? "").trim().slice(0, 120);
      const rate = Number(l.rate);
      const density = l.density == null || String(l.density) === "" ? null : Number(l.density);
      if (!name) return { ok: false, message: "Every row needs a name." };
      if (!Number.isFinite(rate) || rate < 0) return { ok: false, message: `Check the price for ${name}.` };
      if (!UNITS.has(l.unit)) return { ok: false, message: `Pick a unit for ${name}.` };
      if (density != null && (!Number.isFinite(density) || density <= 0)) return { ok: false, message: `Density for ${name} must be a positive number.` };
      const kind = KINDS.has(l.kind) ? l.kind : "other";
      if (l.unit === "t" && (kind === "asphalt" || kind === "base") && !density) return { ok: false, message: `${name} is sold by the tonne, so it needs a density (t/m³).` };

      const id = l.existingId && ids.has(l.existingId) ? l.existingId : byName.get(name.toLowerCase()) ?? null;
      const row = { name, unit: l.unit, rate, material_kind: kind, density_t_per_m3: density, updated_at: now };
      const { error } = id
        ? await db.from("cost_items").update(row).eq("id", id).eq("tenant_id", ctx.tenant.id)
        : await db.from("cost_items").insert({ ...row, tenant_id: ctx.tenant.id, category: "material", supply_plant_id: plant.id, includes_delivery: false, active: true });
      if (error) return { ok: false, message: `${name}: ${error.message}` };
      if (id) updated++; else added++;
    }

    // Binder extra-overs: replace the ones for the binders on this list, keep any others.
    const base = normaliseBinder(input.baseBinder ?? null);
    if (base) await db.from("supply_plants").update({ base_binder: base }).eq("id", plant.id).eq("tenant_id", ctx.tenant.id);
    let binders = 0;
    for (const e of extras) {
      const binder = normaliseBinder(e.binder);
      const x = Number(e.extra_per_t);
      if (!binder || binder === base) continue;
      if (!Number.isFinite(x) || Math.abs(x) > 2000) return { ok: false, message: `Check the extra for ${binderLabel(binder)}.` };
      const { error } = await db.from("binder_extras").upsert(
        { tenant_id: ctx.tenant.id, supply_plant_id: plant.id, binder, extra_per_t: x, updated_at: now },
        { onConflict: "supply_plant_id,binder" },
      );
      if (error) return { ok: false, message: `${binderLabel(binder)}: ${error.message}` };
      binders++;
    }

    const valid = input.validUntil && /^\d{4}-\d{2}-\d{2}$/.test(input.validUntil) ? input.validUntil : null;
    const note = `Price list${input.supplier ? ` from ${String(input.supplier).slice(0, 80)}` : ""} imported ${new Date().toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric", timeZone: "Australia/Brisbane" })}`;
    await db.from("supply_plants").update({ prices_valid_until: valid, prices_note: note }).eq("id", plant.id).eq("tenant_id", ctx.tenant.id);
    revalidatePath("/costs");
    return { ok: true, updated, added, binders };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Import failed." };
  }
}
