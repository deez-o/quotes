import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { findByToken } from "@/lib/quote/accept";
import { loadQuotePdf } from "@/lib/quote/pdf-load";
import { pdfName } from "@/lib/quote/email";
import { quoteLabel } from "@/lib/quote/numbering";
import { appUrl } from "@/lib/app-url";

/** The customer's copy of the quote PDF, from their accept link. */
export async function GET(_: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const admin = createAdminClient();
  const found = await findByToken(admin, token);
  if (!found || found.superseded) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const got = await loadQuotePdf(admin, found.tenantId, found.lead.id, { acceptUrl: `${appUrl()}/accept/${token}` });
  if (!got) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return new NextResponse(Buffer.from(await got.pdf()), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${pdfName(quoteLabel(got.lead, false), got.lead.title ?? "")}"`, "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex" },
  });
}
