/* eslint-disable @next/next/no-img-element -- the logo is a short-lived data URL */
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { findByToken } from "@/lib/quote/accept";
import { loadBrand } from "@/lib/sheet/store";
import { renderTerms } from "@/lib/site/terms";
import { quoteLabel } from "@/lib/quote/numbering";
import { DEFAULT_BRAND, inkOnWhite, isHex, textOn } from "@/lib/branding";
import { AcceptForm } from "./form";

export const metadata: Metadata = { title: "Your quote", robots: { index: false, follow: false } };

const money = (n: number) => `$${n.toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** What the customer sees from the link in the quote email: the quote, and a way to accept it. */
export default async function AcceptPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const admin = createAdminClient();
  const found = await findByToken(admin, token);
  if (!found) notFound();
  const [brand, { data: s }] = await Promise.all([
    loadBrand(admin, found.tenantId),
    admin.from("tenant_settings").select("quote_terms").eq("tenant_id", found.tenantId).maybeSingle(),
  ]);
  const colour = isHex(brand.color) ? brand.color : DEFAULT_BRAND;
  const ink = inkOnWhite(colour);
  const logo = brand.logo ? `data:image/${brand.logo.ext};base64,${Buffer.from(brand.logo.bytes).toString("base64")}` : null;
  const { lead, group, accepted } = found;
  const many = group.length > 1;
  const contact = [brand.phone, brand.email].filter(Boolean).join(" · ");

  const shell = (body: React.ReactNode) => (
    <main style={{ minHeight: "100vh", background: "#f5f6f7", padding: "24px 12px", color: "#1c1f23" }}>
      <div style={{ maxWidth: 760, margin: "0 auto", background: "#fff", borderRadius: 10, overflow: "hidden", border: "1px solid #e1e4e8" }}>
        <div style={{ height: 8, background: colour }} />
        <div style={{ padding: "22px 24px", display: "flex", flexDirection: "column", gap: 18 }}>
          <header style={{ display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
            <div>
              {logo ? <img src={logo} alt={brand.name} style={{ maxHeight: 56, maxWidth: 220, objectFit: "contain", display: "block", marginBottom: 6 }} /> : <div style={{ fontSize: 22, fontWeight: 700 }}>{brand.name}</div>}
              {logo && <div style={{ fontWeight: 600 }}>{brand.name}</div>}
              {brand.abn && <div style={{ fontSize: 13, color: "#5b6168" }}>ABN {brand.abn}</div>}
              {contact && <div style={{ fontSize: 13, color: "#5b6168" }}>{contact}</div>}
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 22, fontWeight: 700, color: ink }}>Quote</div>
              <div>{quoteLabel(lead, false)}</div>
            </div>
          </header>
          {body}
        </div>
      </div>
      <p style={{ textAlign: "center", fontSize: 12, color: "#7a8089" }}>Sent using quoteout</p>
    </main>
  );

  if (found.superseded) {
    return shell(<p style={{ fontSize: 16 }}>This quote has been replaced by a newer version. Please use the link in the latest email from {brand.name}{contact ? `, or contact them on ${contact}` : ""}.</p>);
  }

  return shell(
    <>
      <div>
        <h1 style={{ fontSize: 22, margin: "0 0 4px" }}>{lead.title}</h1>
        <div style={{ color: "#5b6168", fontSize: 14 }}>{[lead.customer_name, lead.site_address].filter(Boolean).join(" — ")}</div>
      </div>

      {accepted && (
        <div style={{ padding: 16, borderRadius: 10, background: "#ecfdf3", border: "1px solid #abefc6" }}>
          <strong>Accepted{many ? ` (Option ${accepted.option_label})` : ""}</strong>
          <div style={{ fontSize: 14 }}>On {new Date(accepted.accepted_at!).toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric", timeZone: "Australia/Brisbane" })}. {brand.name} will be in touch.</div>
        </div>
      )}

      {group.map((g) => {
        const c = g.costing;
        return (
          <section key={g.id} style={{ border: "1px solid #e1e4e8", borderRadius: 10, overflow: "hidden" }}>
            {many && <div style={{ padding: "10px 14px", fontWeight: 700, background: "#f8f9fa" }}>Option {g.option_label}: {g.title}</div>}
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
                <thead><tr style={{ background: colour, color: textOn(colour), textAlign: "left" }}>
                  <th style={{ padding: "8px 12px" }}>Description</th><th style={{ padding: 8, textAlign: "right" }}>Qty</th><th style={{ padding: 8, textAlign: "right" }}>Amount</th>
                </tr></thead>
                <tbody>
                  {(c?.customerLines ?? []).map((l) => (
                    <tr key={l.key} style={{ borderTop: "1px solid #eef0f2" }}>
                      <td style={{ padding: "8px 12px" }}>{l.description}</td>
                      <td style={{ padding: 8, textAlign: "right", whiteSpace: "nowrap" }}>{l.quantity.toLocaleString("en-AU")} {l.unit}</td>
                      <td style={{ padding: 8, textAlign: "right" }}>{money(l.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ padding: "10px 14px", display: "grid", justifyContent: "end", gap: 2, textAlign: "right", fontSize: 14 }}>
              <div>Total ex GST <strong style={{ marginLeft: 12 }}>{money(c?.priceExGst ?? 0)}</strong></div>
              <div>GST <span style={{ marginLeft: 12 }}>{money(c?.gst ?? 0)}</span></div>
              <div style={{ fontSize: 17, color: ink, fontWeight: 700 }}>Total inc GST <span style={{ marginLeft: 12 }}>{money(c?.priceIncGst ?? 0)}</span></div>
            </div>
            {(c?.optionalRates ?? []).length > 0 && (
              <div style={{ padding: "4px 14px 14px", fontSize: 14 }}>
                <strong>Rates, if needed</strong> <span style={{ color: "#6b7280" }}>(not included in the total, ex GST)</span>
                {(c?.optionalRates ?? []).map((r) => (
                  <div key={r.key} style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "4px 0", borderTop: "1px solid #eef0f2" }}><span>{r.description}</span><span style={{ whiteSpace: "nowrap" }}>{r.total ? `${money(r.total)} lump sum (${r.quantity?.toLocaleString("en-AU")} ${r.unit} @ ${money(r.rate)})` : `${money(r.rate)} per ${r.unit}`}</span></div>
                ))}
              </div>
            )}
          </section>
        );
      })}

      {(lead.inclusions?.length > 0 || lead.exclusions?.length > 0) && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 14, fontSize: 14 }}>
          {lead.inclusions?.length > 0 && <div><strong>Included</strong><ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>{lead.inclusions.map((x, i) => <li key={i}>{x}</li>)}</ul></div>}
          {lead.exclusions?.length > 0 && <div><strong>Not included</strong><ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>{lead.exclusions.map((x, i) => <li key={i}>{x}</li>)}</ul></div>}
        </div>
      )}

      <a href={`/accept/${token}/pdf`} target="_blank" rel="noreferrer" style={{ fontWeight: 600, color: ink }}>Download the quote PDF</a>

      <details style={{ fontSize: 13, color: "#33383f" }}>
        <summary style={{ cursor: "pointer", fontWeight: 600 }}>Terms</summary>
        <div style={{ whiteSpace: "pre-wrap", marginTop: 6 }}>{renderTerms(s?.quote_terms as string | null, lead.created_at)}</div>
      </details>

      {!accepted && (
        <section style={{ borderTop: "1px solid #e1e4e8", paddingTop: 18 }}>
          <h2 style={{ fontSize: 18, margin: "0 0 12px" }}>Accept this quote</h2>
          <AcceptForm token={token} brand={colour} onBrand={textOn(colour)}
            options={group.map((g) => ({ id: g.id, label: g.option_label, title: g.title ?? "", total: `${money(g.costing?.priceIncGst ?? 0)} inc GST` }))} />
        </section>
      )}
    </>,
  );
}
