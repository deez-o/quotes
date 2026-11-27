"use server";

import { revalidatePath } from "next/cache";
import { requireTenant } from "@/lib/tenant";
import { createClient } from "@/lib/supabase/server";
import { aiCaller } from "@/lib/ai/call";
import { outline, grid, sheetNames } from "@/lib/sheet/read";
import { cleanMapping, MAPPING_SCHEMA, mappingMessages, SAMPLE_QUOTE, type SheetMapping } from "@/lib/sheet/map";
import { fillSheet, loadSheet, templateBytes, type StoredSheet } from "@/lib/sheet/store";

export type Preview = {
  filename: string;
  mapping: SheetMapping;
  sheets: string[];
  grid: { rows: string[][]; cols: string[] };
  written: string[];
  keptFormulas: string[];
  confirmed: boolean;
  notes: string;
};
type Result<T> = ({ ok: true } & T) | { ok: false; message: string };

async function admin() {
  const ctx = await requireTenant();
  if (ctx.role !== "admin") throw new Error("Only your company's admin can set up the quote spreadsheet.");
  return { ctx, db: await createClient() };
}

async function save(db: Awaited<ReturnType<typeof createClient>>, tenantId: string, sheet: StoredSheet | null) {
  const { error } = await db.from("tenant_settings").update({ quote_sheet: sheet }).eq("tenant_id", tenantId);
  if (error) throw new Error(error.message);
}

async function preview(sheet: StoredSheet, bytes: Uint8Array): Promise<Preview> {
  const mapping = sheet.mapping!;
  const filled = await fillSheet(bytes, mapping, SAMPLE_QUOTE);
  return {
    filename: sheet.filename, mapping, sheets: await sheetNames(bytes),
    grid: await grid(filled.bytes, mapping.sheet), written: filled.written, keptFormulas: filled.keptFormulas,
    confirmed: Boolean(sheet.confirmed_at), notes: mapping.notes,
  };
}

/** A freshly uploaded sheet: the AI works out where each part of a quote goes, then shows it filled with a sample. */
export async function mapQuoteSheet(input: { path: string; filename: string }): Promise<Result<{ preview: Preview }>> {
  try {
    const { ctx, db } = await admin();
    if (!input.path.startsWith(`${ctx.tenant.id}/uploads/quotesheet-`) || input.path.includes("..")) return { ok: false, message: "Upload the sheet again." };
    if (!/\.(xlsx|xlsm)$/i.test(input.filename)) return { ok: false, message: "Use an Excel file (.xlsx or .xlsm). Save older .xls files as .xlsx first." };
    const { data, error } = await db.storage.from("job-files").download(input.path);
    if (error || !data) return { ok: false, message: "Couldn't open that file. Try uploading it again." };
    const bytes = new Uint8Array(await data.arrayBuffer());
    let o: Awaited<ReturnType<typeof outline>>;
    try { o = await outline(bytes); } catch { return { ok: false, message: "That file couldn't be opened as an Excel workbook." }; }

    const call = await aiCaller(MAPPING_SCHEMA, ctx.tenant.id, ctx.userId, "ai_sheet");
    let mapping: SheetMapping | null = null;
    if (call) {
      try { mapping = cleanMapping((await call(mappingMessages(o.text))).json, o.sheets); } catch { mapping = null; }
    }
    mapping ??= cleanMapping({ sheet: o.sheets[0], fields: [], lines: {}, notes: "Couldn't work the sheet out automatically: set the cells below." }, o.sheets)!;
    const sheet: StoredSheet = { path: input.path, filename: input.filename.slice(0, 200), mapping, confirmed_at: null };
    await save(db, ctx.tenant.id, sheet);
    revalidatePath("/setup");
    return { ok: true, preview: await preview(sheet, bytes) };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Couldn't read that sheet." };
  }
}

/** The sheet as it's set up now, filled with the sample quote. */
export async function currentPreview(): Promise<Result<{ preview: Preview | null }>> {
  try {
    const { ctx, db } = await admin();
    const sheet = await loadSheet(db, ctx.tenant.id);
    if (!sheet?.mapping) return { ok: true, preview: null };
    return { ok: true, preview: await preview(sheet, await templateBytes(db, sheet)) };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Couldn't open the sheet." };
  }
}

/** Fix where things go; the preview updates. Saving a change asks for a fresh confirm. */
export async function updateMapping(raw: SheetMapping): Promise<Result<{ preview: Preview }>> {
  try {
    const { ctx, db } = await admin();
    const sheet = await loadSheet(db, ctx.tenant.id);
    if (!sheet) return { ok: false, message: "Upload your quote spreadsheet first." };
    const bytes = await templateBytes(db, sheet);
    const mapping = cleanMapping(raw, await sheetNames(bytes));
    if (!mapping) return { ok: false, message: "That setup isn't valid." };
    const next: StoredSheet = { ...sheet, mapping: { ...mapping, notes: sheet.mapping?.notes ?? "" }, confirmed_at: null };
    await save(db, ctx.tenant.id, next);
    return { ok: true, preview: await preview(next, bytes) };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Couldn't update it." };
  }
}

export async function confirmQuoteSheet(): Promise<Result<object>> {
  try {
    const { ctx, db } = await admin();
    const sheet = await loadSheet(db, ctx.tenant.id);
    if (!sheet?.mapping) return { ok: false, message: "Upload your quote spreadsheet first." };
    await save(db, ctx.tenant.id, { ...sheet, confirmed_at: new Date().toISOString() });
    revalidatePath("/setup");
    return { ok: true };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Couldn't save it." };
  }
}

export async function removeQuoteSheet(): Promise<Result<object>> {
  try {
    const { ctx, db } = await admin();
    await save(db, ctx.tenant.id, null);
    revalidatePath("/setup");
    return { ok: true };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Couldn't remove it." };
  }
}
