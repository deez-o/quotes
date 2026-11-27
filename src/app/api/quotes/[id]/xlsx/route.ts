import { NextResponse } from "next/server";
import { requireTenant } from "@/lib/tenant";
import { createClient } from "@/lib/supabase/server";
import { quoteWorkbook } from "@/lib/sheet/export";
import { xlsxResponse } from "@/lib/sheet/response";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** One quote as Excel: their own quote sheet, or the workings sheet. */
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const ctx = await requireTenant();
  const out = await quoteWorkbook(await createClient(), ctx.tenant.id, id, ctx.email);
  if (!out) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return xlsxResponse(out.bytes, out.filename);
}
