import { NextResponse } from "next/server";
import { requireTenant } from "@/lib/tenant";
import { createClient } from "@/lib/supabase/server";
import type { Priced } from "@/lib/site/price";
import { fillSheet, loadBrand, loadSheet, sheetQuoteFrom, templateBytes } from "@/lib/sheet/store";
import { defaultWorkbook } from "@/lib/sheet/default";
import { xlsxResponse } from "@/lib/sheet/response";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** One quote, filled into the company's own quote spreadsheet. */
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const ctx = await requireTenant();
  const db = await createClient();
  const [{ data: q }, sheet, { data: s }] = await Promise.all([
    db.from("site_quotes").select("quote_no, title, customer_name, customer_email, site_address, created_at, costing").eq("tenant_id", ctx.tenant.id).eq("id", id).maybeSingle(),
    loadSheet(db, ctx.tenant.id),
    db.from("tenant_settings").select("quote_terms").eq("tenant_id", ctx.tenant.id).maybeSingle(),
  ]);
  if (!q) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const data = sheetQuoteFrom({ ...q, costing: q.costing as Priced | null }, s?.quote_terms ?? null, ctx.email);
  const base = [q.quote_no, q.title].filter(Boolean).join(" ") || "Quote";
  // Their own sheet once they've confirmed it; quoteout's standard sheet until then.
  if (sheet?.mapping && sheet.confirmed_at) {
    const out = await fillSheet(await templateBytes(db, sheet), sheet.mapping, data);
    return xlsxResponse(out.bytes, `${base}${sheet.filename.match(/\.xls[xm]$/i)?.[0] ?? ".xlsx"}`);
  }
  return xlsxResponse(await defaultWorkbook(await loadBrand(db, ctx.tenant.id), data), `${base}.xlsx`);
}
