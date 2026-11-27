import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Priced } from "@/lib/site/price";
import { renderTerms } from "@/lib/site/terms";
import { loadBrand } from "@/lib/sheet/store";
import { quotePdf, type QuotePdfData } from "./pdf";

export type LoadedQuote = {
  id: string; quote_no: string | null; title: string | null; customer_name: string | null; customer_email: string | null;
  site_address: string | null; costing: Priced | null; total_ex_gst: number | null; created_at: string; updated_at: string | null;
};

/** One quote as its customer PDF, plus the facts the email needs. */
export async function loadQuotePdf(db: SupabaseClient, tenantId: string, id: string) {
  const [{ data: q }, brand, { data: s }] = await Promise.all([
    db.from("site_quotes").select("id, quote_no, title, customer_name, customer_email, site_address, costing, total_ex_gst, created_at, updated_at").eq("tenant_id", tenantId).eq("id", id).maybeSingle(),
    loadBrand(db, tenantId),
    db.from("tenant_settings").select("quote_terms, quote_email_message").eq("tenant_id", tenantId).maybeSingle(),
  ]);
  if (!q) return null;
  const quote = q as LoadedQuote;
  const c = quote.costing;
  const data: QuotePdfData = {
    brand: brand.color ?? "#16181B",
    business: { name: brand.name, abn: brand.abn, address: brand.address, contact: [brand.phone, brand.email, brand.website].filter(Boolean).join(" · ") || null },
    logo: brand.logo ? { bytes: brand.logo.bytes, type: brand.logo.ext === "png" ? "png" : "jpg" } : null,
    quote: {
      number: quote.quote_no, title: quote.title || "Quote", customer: quote.customer_name, customerEmail: quote.customer_email, site: quote.site_address,
      date: new Date(quote.updated_at ?? quote.created_at).toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric", timeZone: "Australia/Brisbane" }),
    },
    lines: (c?.customerLines ?? []).map((l) => ({ description: l.description, quantity: l.quantity, unit: l.unit, rate: l.rate, total: l.total })),
    totals: { exGst: c?.priceExGst ?? 0, gst: c?.gst ?? 0, incGst: c?.priceIncGst ?? 0, gstPercent: brand.gstPercent },
    terms: renderTerms(s?.quote_terms as string | null, quote.created_at),
  };
  return { quote, brand, data, emailTemplate: (s?.quote_email_message as string | null) ?? null, pdf: () => quotePdf(data) };
}
