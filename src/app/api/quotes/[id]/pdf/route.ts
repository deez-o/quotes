import { NextResponse } from "next/server";
import { requireTenant } from "@/lib/tenant";
import { createClient } from "@/lib/supabase/server";
import { loadQuotePdf } from "@/lib/quote/pdf-load";
import { pdfName } from "@/lib/quote/email";
import { appUrl } from "@/lib/app-url";
import { quoteLabel } from "@/lib/quote/numbering";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The PDF exactly as it would be emailed to the customer. */
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const ctx = await requireTenant();
  const db = await createClient();
  const first = await loadQuotePdf(db, ctx.tenant.id, id);
  if (!first) return NextResponse.json({ error: "Not found" }, { status: 404 });
  // Once sent, the PDF carries its accept link; before that, show where it will go.
  const got = first.lead.accept_token ? (await loadQuotePdf(db, ctx.tenant.id, id, { acceptUrl: `${appUrl()}/accept/${first.lead.accept_token}` }))! : first;
  const bytes = await got.pdf();
  return new NextResponse(Buffer.from(bytes), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${pdfName(quoteLabel(got.lead, false), got.lead.title ?? "")}"`, "Cache-Control": "private, no-store" },
  });
}
