import { NextResponse } from "next/server";
import { requireTenant } from "@/lib/tenant";
import { createClient } from "@/lib/supabase/server";
import { SAMPLE_QUOTE } from "@/lib/sheet/map";
import { fillSheet, loadSheet, templateBytes } from "@/lib/sheet/store";
import { xlsxResponse } from "@/lib/sheet/response";

/** The company's quote spreadsheet filled with the sample quote, to open in Excel and check. */
export async function GET() {
  const ctx = await requireTenant();
  const db = await createClient();
  const sheet = await loadSheet(db, ctx.tenant.id);
  if (!sheet?.mapping) return NextResponse.json({ error: "No quote spreadsheet set up." }, { status: 404 });
  const out = await fillSheet(await templateBytes(db, sheet), sheet.mapping, SAMPLE_QUOTE);
  return xlsxResponse(out.bytes, `Sample - ${sheet.filename}`);
}
