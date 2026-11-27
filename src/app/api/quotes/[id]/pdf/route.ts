import { NextResponse } from "next/server";
import { requireTenant } from "@/lib/tenant";
import { createClient } from "@/lib/supabase/server";
import { loadQuotePdf } from "@/lib/quote/pdf-load";
import { pdfName } from "@/lib/quote/email";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The PDF exactly as it would be emailed to the customer. */
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const ctx = await requireTenant();
  const got = await loadQuotePdf(await createClient(), ctx.tenant.id, id);
  if (!got) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const bytes = await got.pdf();
  return new NextResponse(Buffer.from(bytes), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${pdfName(got.quote.quote_no, got.quote.title ?? "")}"`, "Cache-Control": "private, no-store" },
  });
}
