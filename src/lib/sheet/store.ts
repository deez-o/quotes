import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Priced } from "@/lib/site/price";
import { renderTerms } from "@/lib/site/terms";
import { fillWorkbook } from "./fill";
import { writesFor, type SheetMapping, type SheetQuote } from "./map";

export const SHEET_BUCKET = "job-files";

export type StoredSheet = { path: string; filename: string; mapping: SheetMapping | null; confirmed_at: string | null; notes?: string };

export async function loadSheet(db: SupabaseClient, tenantId: string): Promise<StoredSheet | null> {
  const { data } = await db.from("tenant_settings").select("quote_sheet").eq("tenant_id", tenantId).maybeSingle();
  const s = data?.quote_sheet as StoredSheet | null;
  return s && typeof s.path === "string" && s.path.startsWith(`${tenantId}/`) ? s : null;
}

export async function templateBytes(db: SupabaseClient, sheet: StoredSheet) {
  const { data, error } = await db.storage.from(SHEET_BUCKET).download(sheet.path);
  if (error || !data) throw new Error("Couldn't open your quote spreadsheet. Upload it again in Setup.");
  return new Uint8Array(await data.arrayBuffer());
}

const ddmmyyyy = (d: Date) => d.toLocaleDateString("en-AU", { timeZone: "Australia/Brisbane", day: "2-digit", month: "2-digit", year: "numeric" });

/** What goes into the sheet for one quote: the same lines and totals as the PDF. */
export function sheetQuoteFrom(q: {
  quote_no: string | null; title: string | null; customer_name: string | null; customer_email: string | null; site_address: string | null;
  created_at: string; costing: Priced | null;
}, terms: string | null, preparedBy: string | null): SheetQuote {
  const c = q.costing;
  const lines = (c?.customerLines ?? []).map((l) => ({ description: l.description, quantity: l.quantity, unit: l.unit, rate: l.rate, total: l.total }));
  const now = new Date();
  return {
    values: {
      quote_no: q.quote_no ?? "", date: ddmmyyyy(now), valid_until: ddmmyyyy(new Date(now.getTime() + 30 * 864e5)),
      customer_name: q.customer_name ?? "", customer_email: q.customer_email ?? "", site_address: q.site_address ?? "",
      job_title: q.title ?? "", scope_summary: lines.map((l) => l.description).join("; "),
      subtotal_ex_gst: c?.priceExGst ?? 0, gst: c?.gst ?? 0, total_inc_gst: c?.priceIncGst ?? 0,
      terms: renderTerms(terms, q.created_at), prepared_by: preparedBy ?? "",
    },
    lines,
  };
}

export async function fillSheet(bytes: Uint8Array, mapping: SheetMapping, quote: SheetQuote) {
  const { writes, combined } = writesFor(mapping, quote);
  const { bytes: out, keptFormulas } = await fillWorkbook(bytes, mapping.sheet, writes);
  return { bytes: out, combined, keptFormulas, written: writes.filter((w) => w.value !== null && w.value !== "").map((w) => w.cell) };
}

/** The company's branding for the standard sheet: same details and logo as the PDF. */
export async function loadBrand(db: SupabaseClient, tenantId: string): Promise<import("./default").SheetBrand> {
  const [{ data: s }, { data: t }] = await Promise.all([
    db.from("tenant_settings").select("logo_path, brand_color, business_name, business_abn, business_phone, business_email, business_address, business_website, gst_percent").eq("tenant_id", tenantId).maybeSingle(),
    db.from("tenants").select("name, abn").eq("id", tenantId).maybeSingle(),
  ]);
  let logo: import("./default").SheetBrand["logo"] = null;
  const lp = s?.logo_path as string | null;
  const ext = lp?.match(/\.(png|jpe?g)$/i)?.[1]?.toLowerCase();
  if (lp && lp.startsWith(`${tenantId}/`) && ext) {
    const { data } = await db.storage.from(SHEET_BUCKET).download(lp);
    if (data) logo = { bytes: new Uint8Array(await data.arrayBuffer()), ext: ext === "png" ? "png" : "jpeg" };
  }
  return {
    name: (s?.business_name as string) || (t?.name as string) || "Quote",
    abn: (s?.business_abn as string) || (t?.abn as string) || null,
    phone: (s?.business_phone as string) || null, email: (s?.business_email as string) || null,
    address: (s?.business_address as string) || null, website: (s?.business_website as string) || null,
    color: (s?.brand_color as string) || null, logo, gstPercent: Number(s?.gst_percent ?? 10),
  };
}
