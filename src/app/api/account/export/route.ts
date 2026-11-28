import JSZip from "jszip";
import { NextResponse } from "next/server";
import { requireTenant } from "@/lib/tenant";
import { createClient } from "@/lib/supabase/server";
import { toCsv } from "@/lib/csv";
import { loadQuotePdf } from "@/lib/quote/pdf-load";
import { pdfName } from "@/lib/quote/email";
import { quoteLabel } from "@/lib/quote/numbering";

export const maxDuration = 300;
const PDFS = 100;

/** Everything the company has in quoteout, as a zip of spreadsheets and quote PDFs. Client admins only. */
export async function GET() {
  const ctx = await requireTenant();
  if (ctx.role !== "admin") return NextResponse.json({ error: "Only a client admin can download all the data." }, { status: 403 });
  const db = await createClient();
  const t = ctx.tenant.id;
  const [{ data: quotes }, { data: customers }, { data: costs }, { data: plants }, { data: sends }] = await Promise.all([
    db.from("site_quotes").select("id, quote_no, revision, option_label, status, title, customer_name, customer_email, site_address, total_ex_gst, margin_percent, created_at, sent_at, accepted_at, accepted_name, accepted_po, superseded_at, inclusions, exclusions, costing").eq("tenant_id", t).order("created_at", { ascending: false }).limit(20000),
    db.from("customers").select("name, contact_name, email, phone, address, abn, notes, created_at").eq("tenant_id", t).order("name"),
    db.from("cost_items").select("category, material_kind, name, unit, rate, density_t_per_m3, includes_delivery, truck_capacity_t, notes, active").eq("tenant_id", t).order("category"),
    db.from("supply_plants").select("name, address, lat, lng, active").eq("tenant_id", t),
    db.from("quote_sends").select("site_quote_id, to_addresses, cc_addresses, subject, sent_by_email, status, created_at").eq("tenant_id", t).order("created_at", { ascending: false }).limit(20000),
  ]);
  const zip = new JSZip();
  const label = new Map((quotes ?? []).map((q) => [q.id as string, quoteLabel(q)]));
  zip.file("quotes.csv", toCsv((quotes ?? []).map((q) => ({
    number: quoteLabel(q), status: q.status, job: q.title, customer: q.customer_name, customer_email: q.customer_email, site: q.site_address,
    price_ex_gst: q.total_ex_gst, margin_percent: q.margin_percent, created: q.created_at, sent: q.sent_at, accepted: q.accepted_at, accepted_by: q.accepted_name, po_number: q.accepted_po,
    replaced_by_newer: q.superseded_at ? "yes" : "", included: q.inclusions, not_included: q.exclusions,
  }))));
  zip.file("quote-lines.csv", toCsv((quotes ?? []).flatMap((q) => ((q.costing as { customerLines?: { description: string; quantity: number; unit: string; rate: number; total: number }[] } | null)?.customerLines ?? [])
    .map((l) => ({ number: quoteLabel(q), description: l.description, quantity: l.quantity, unit: l.unit, rate: l.rate, total: l.total })))));
  zip.file("customers.csv", toCsv(customers ?? []));
  zip.file("costs.csv", toCsv(costs ?? []));
  zip.file("supply-plants.csv", toCsv(plants ?? []));
  zip.file("emails-sent.csv", toCsv((sends ?? []).map((s) => ({ quote: label.get(s.site_quote_id as string) ?? s.site_quote_id, to: s.to_addresses, cc: s.cc_addresses, subject: s.subject, sent_by: s.sent_by_email, status: s.status, at: s.created_at }))));

  // The latest quotes as PDFs (one per quote, with its options).
  const seen = new Set<string>();
  const folder = zip.folder("quote-pdfs")!;
  let n = 0;
  for (const q of quotes ?? []) {
    if (n >= PDFS) break;
    if (q.superseded_at || (q.option_label && q.option_label !== "A")) continue;
    const got = await loadQuotePdf(db, t, q.id as string, { noMap: true }).catch(() => null);
    if (!got || !got.data.options.some((o) => o.lines.length)) continue;
    const name = pdfName(quoteLabel(got.lead, false), got.lead.title ?? "");
    if (seen.has(name)) continue;
    seen.add(name);
    folder.file(name, await got.pdf());
    n++;
  }
  zip.file("README.txt", `quoteout data for ${ctx.tenant.name}, downloaded ${new Date().toISOString()}.\r\nCSV files open in Excel. quote-pdfs has the latest ${PDFS} quotes as PDFs.\r\n`);
  const bytes = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
  const safe = ctx.tenant.name.replace(/[^\w\- ]+/g, "_").slice(0, 60) || "company";
  return new NextResponse(Buffer.from(bytes), { headers: { "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="quoteout data - ${safe}.zip"`, "Cache-Control": "private, no-store" } });
}
