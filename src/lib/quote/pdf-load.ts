import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Priced } from "@/lib/site/price";
import type { Overview } from "@/lib/rfq/overview";
import { renderTerms } from "@/lib/site/terms";
import { loadBrand } from "@/lib/sheet/store";
import { quotePdf, type QuotePdfData } from "./pdf";
import { fetchStaticMap } from "./static-map";
import { quoteLabel } from "./numbering";

export type LoadedQuote = {
  id: string; quote_no: string | null; title: string | null; customer_name: string | null; customer_email: string | null;
  site_address: string | null; site_lat: number | null; site_lng: number | null; costing: Priced | null; total_ex_gst: number | null;
  created_at: string; updated_at: string | null; option_group: string | null; option_label: string | null; revision: number;
  superseded_at: string | null; inclusions: string[]; exclusions: string[]; show_map: boolean; accept_token: string | null;
  accepted_at: string | null; status: string; overview: Overview | null;
};
export const QUOTE_COLUMNS = "id, quote_no, title, customer_name, customer_email, site_address, site_lat, site_lng, costing, total_ex_gst, created_at, updated_at, option_group, option_label, revision, superseded_at, inclusions, exclusions, show_map, accept_token, accepted_at, status, overview";

/** A quote and its other options (current revision), Option A first. */
export async function loadGroup(db: SupabaseClient, tenantId: string, id: string): Promise<LoadedQuote[] | null> {
  const { data: q } = await db.from("site_quotes").select(QUOTE_COLUMNS).eq("tenant_id", tenantId).eq("id", id).maybeSingle();
  if (!q) return null;
  const one = q as unknown as LoadedQuote;
  if (!one.option_group) return [one];
  const { data: all } = await db.from("site_quotes").select(QUOTE_COLUMNS).eq("tenant_id", tenantId).eq("option_group", one.option_group)
    .eq("revision", one.revision).order("option_label");
  const list = (all ?? []) as unknown as LoadedQuote[];
  return list.length ? list : [one];
}

/** The quote (with any options) as its customer PDF, plus what the email needs. */
export async function loadQuotePdf(db: SupabaseClient, tenantId: string, id: string, opts: { acceptUrl?: string | null; noMap?: boolean } = {}) {
  const [group, brand, { data: s }] = await Promise.all([
    loadGroup(db, tenantId, id),
    loadBrand(db, tenantId),
    db.from("tenant_settings").select("quote_terms, quote_email_message").eq("tenant_id", tenantId).maybeSingle(),
  ]);
  if (!group) return null;
  const quote = group.find((g) => g.id === id) ?? group[0];
  const lead = group[0];
  const options = group.map((g) => {
    const c = g.costing;
    return {
      id: g.id, label: group.length > 1 ? g.option_label : null, title: g.title || "Quote",
      lines: (c?.customerLines ?? []).map((l) => ({ description: l.description, quantity: l.quantity, unit: l.unit, rate: l.rate, total: l.total })),
      totals: { exGst: c?.priceExGst ?? 0, gst: c?.gst ?? 0, incGst: c?.priceIncGst ?? 0 },
      rates: (c?.optionalRates ?? []).map((r) => ({ description: r.description, unit: r.unit, rate: r.rate })),
    };
  });
  const areas = lead.overview?.areas ?? [];
  const mapPng = !opts.noMap && lead.show_map && areas.length && lead.site_lat != null && lead.site_lng != null
    ? await fetchStaticMap({ lat: lead.site_lat, lng: lead.site_lng }, areas) : null;
  const data: QuotePdfData = {
    brand: brand.color ?? "#16181B",
    business: { name: brand.name, abn: brand.abn, address: brand.address, contact: [brand.phone, brand.email, brand.website].filter(Boolean).join(" · ") || null },
    logo: brand.logo ? { bytes: brand.logo.bytes, type: brand.logo.ext === "png" ? "png" : "jpg" } : null,
    quote: {
      number: quoteLabel(lead, false), title: lead.title || "Quote",
      customer: lead.customer_name, customerEmail: lead.customer_email, site: lead.site_address,
      date: new Date(Math.max(...group.map((g) => +new Date(g.updated_at ?? g.created_at)))).toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric", timeZone: "Australia/Brisbane" }),
    },
    options, gstPercent: brand.gstPercent,
    inclusions: lead.inclusions ?? [], exclusions: lead.exclusions ?? [],
    map: mapPng ? { png: mapPng, areas: areas.map((a) => ({ name: a.name, m2: a.m2, color: a.color })) } : null,
    acceptUrl: opts.acceptUrl ?? null,
    terms: renderTerms(s?.quote_terms as string | null, lead.created_at),
  };
  return { quote, lead, group, brand, data, emailTemplate: (s?.quote_email_message as string | null) ?? null, pdf: () => quotePdf(data) };
}
