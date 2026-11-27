import { requireTenant } from "@/lib/tenant";
import { createClient } from "@/lib/supabase/server";
import { SAMPLE_QUOTE } from "@/lib/sheet/map";
import { fillSheet, loadBrand, loadSheet, templateBytes } from "@/lib/sheet/store";
import { defaultWorkbook } from "@/lib/sheet/default";
import { xlsxResponse } from "@/lib/sheet/response";

/** The company's quote spreadsheet filled with the sample quote, to open in Excel and check. */
export async function GET(request: Request) {
  const ctx = await requireTenant();
  const db = await createClient();
  const sheet = await loadSheet(db, ctx.tenant.id);
  const standard = new URL(request.url).searchParams.get("standard") === "1";
  if (sheet?.mapping && !standard) {
    const out = await fillSheet(await templateBytes(db, sheet), sheet.mapping, SAMPLE_QUOTE);
    return xlsxResponse(out.bytes, `Sample - ${sheet.filename}`);
  }
  return xlsxResponse(await defaultWorkbook(await loadBrand(db, ctx.tenant.id), SAMPLE_QUOTE), "Sample - quoteout standard quote.xlsx");
}
