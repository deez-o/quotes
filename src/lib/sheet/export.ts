import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { priceSiteQuote, type HaulRoutes, type Priced, type SiteScope } from "@/lib/site/price";
import { emptyScope, haulFor, loadPricingContext } from "@/lib/site/load";
import { fillSheet, loadBrand, loadSheet, sheetQuoteFrom, templateBytes } from "@/lib/sheet/store";
import { defaultWorkbook } from "@/lib/sheet/default";

/** A quote as Excel: the company's own sheet once confirmed, otherwise quoteout's workings sheet. */
export async function quoteWorkbook(db: SupabaseClient, tenantId: string, id: string, email: string | null): Promise<{ bytes: Uint8Array; filename: string } | null> {
  const [{ data: q }, sheet, { data: s }] = await Promise.all([
    db.from("site_quotes").select("quote_no, title, customer_name, customer_email, site_address, created_at, costing, scope, margin_percent, site_lat, site_lng, haul_routes").eq("tenant_id", tenantId).eq("id", id).maybeSingle(),
    loadSheet(db, tenantId),
    db.from("tenant_settings").select("quote_terms").eq("tenant_id", tenantId).maybeSingle(),
  ]);
  if (!q) return null;
  const data = sheetQuoteFrom({ ...q, costing: q.costing as Priced | null }, s?.quote_terms ?? null, email);
  const base = [q.quote_no, q.title].filter(Boolean).join(" ") || "Quote";
  if (sheet?.mapping && sheet.confirmed_at) {
    const out = await fillSheet(await templateBytes(db, sheet), sheet.mapping, data);
    return { bytes: out.bytes, filename: `${base}${sheet.filename.match(/\.xls[xm]$/i)?.[0] ?? ".xlsx"}` };
  }
  // Price it again from the scope so every line carries its numbers for the formulas.
  const pc = await loadPricingContext(db, tenantId);
  const scope = { ...emptyScope(q.title ?? "Quote"), ...(q.scope as Partial<SiteScope>) };
  const haul = haulFor(scope, { lat: q.site_lat, lng: q.site_lng }, pc.plants, pc.settings, q.haul_routes as HaulRoutes | null);
  const priced = priceSiteQuote({ scope, library: pc.library, settings: pc.settings, haul, marginPercent: Number(q.margin_percent) });
  const plant = pc.plants.find((p) => p.id === scope.supply_plant_id)?.name ?? null;
  const bytes = await defaultWorkbook(await loadBrand(db, tenantId), data, { priced, marginPercent: Number(q.margin_percent), plant, haul: haul ? { km: haul.km, minutes: haul.minutes } : null });
  return { bytes, filename: `${base} workings.xlsx` };
}
