import { NextResponse } from "next/server";
import { requireTenant } from "@/lib/tenant";
import { createClient } from "@/lib/supabase/server";
import type { Priced } from "@/lib/site/price";
import { fillSheet, loadSheet, sheetQuoteFrom, templateBytes } from "@/lib/sheet/store";
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
  if (!sheet?.mapping || !sheet.confirmed_at) return NextResponse.json({ error: "Set up your quote spreadsheet in Setup first." }, { status: 409 });
  const data = sheetQuoteFrom({ ...q, costing: q.costing as Priced | null }, s?.quote_terms ?? null, ctx.email);
  const out = await fillSheet(await templateBytes(db, sheet), sheet.mapping, data);
  const base = [q.quote_no, q.title].filter(Boolean).join(" ") || "Quote";
  return xlsxResponse(out.bytes, `${base}${sheet.filename.match(/\.xls[xm]$/i)?.[0] ?? ".xlsx"}`);
}
