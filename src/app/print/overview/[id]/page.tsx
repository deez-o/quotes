/* eslint-disable @next/next/no-img-element -- map and Street View come from our own routes, logos from signed URLs */
import { notFound } from "next/navigation";
import { requireTenant } from "@/lib/tenant";
import { createClient } from "@/lib/supabase/server";
import type { Overview } from "@/lib/rfq/overview";
import { DEFAULT_BRAND, isHex } from "@/lib/branding";
import { PrintButton } from "../../site/[id]/print-button";

/** The job overview for the office or crew: specs, areas on the map, the street, dates and conditions. */
export default async function PrintOverview({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireTenant();
  const db = await createClient();
  const [{ data: q }, { data: settings }] = await Promise.all([
    db.from("site_quotes").select("id, quote_no, title, customer_name, site_address, site_lat, site_lng, overview, updated_at")
      .eq("tenant_id", ctx.tenant.id).eq("id", id).maybeSingle(),
    db.from("tenant_settings").select("brand_color, business_name").eq("tenant_id", ctx.tenant.id).maybeSingle(),
  ]);
  if (!q) notFound();
  const ov = (q.overview ?? null) as Overview | null;
  const brand = isHex(settings?.brand_color) ? settings!.brand_color : DEFAULT_BRAND;
  const located = q.site_lat != null && q.site_lng != null;
  const v = encodeURIComponent(String(q.updated_at ?? ""));
  const areas = ov?.areas ?? [];
  const h2 = { fontSize: 15, margin: "18px 0 6px", borderBottom: "1px solid #e1e4e8", paddingBottom: 4 } as const;

  return (
    <main style={{ maxWidth: 780, margin: "0 auto", padding: "32px 28px", background: "#fff", minHeight: "100vh", color: "#1c1f23", fontSize: 13 }}>
      <style>{`@page { size: A4; margin: 14mm } @media print { .no-print { display: none !important } body { background: #fff } main { padding: 0 !important } .keep { break-inside: avoid } }`}</style>
      <div className="no-print" style={{ display: "flex", justifyContent: "flex-end", marginBottom: 16 }}><PrintButton /></div>
      <div style={{ height: 6, background: brand, marginBottom: 16, WebkitPrintColorAdjust: "exact", printColorAdjust: "exact" }} />
      <div style={{ color: "#5b636d" }}>{settings?.business_name} · Job overview</div>
      <h1 style={{ fontSize: 22, margin: "4px 0" }}>{q.title}</h1>
      <div>{[q.quote_no, q.customer_name, q.site_address].filter(Boolean).join(" — ")}</div>
      {ov?.summary && <p style={{ marginTop: 10 }}>{ov.summary}</p>}

      {located && (
        <div className="keep">
          <h2 style={h2}>Site</h2>
          <img src={`/api/quotes/${q.id}/map?v=${v}`} alt="Satellite map of the site" style={{ width: "100%", borderRadius: 4, display: "block" }} />
          {areas.length > 0 && (
            <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 6 }}>
              <tbody>
                {areas.map((a) => (
                  <tr key={a.id}>
                    <td style={{ padding: "3px 0", width: 18 }}><span style={{ display: "inline-block", width: 12, height: 12, background: a.color, WebkitPrintColorAdjust: "exact", printColorAdjust: "exact" }} /></td>
                    <td style={{ padding: "3px 0" }}>{a.name}</td>
                    <td style={{ padding: "3px 0", textAlign: "right", fontWeight: 600 }}>{a.m2.toLocaleString("en-AU")} m²</td>
                  </tr>
                ))}
                <tr style={{ borderTop: "1px solid #e1e4e8" }}><td /><td style={{ padding: "3px 0" }}>Total measured</td><td style={{ padding: "3px 0", textAlign: "right", fontWeight: 700 }}>{areas.reduce((s, a) => s + a.m2, 0).toLocaleString("en-AU")} m²</td></tr>
              </tbody>
            </table>
          )}
        </div>
      )}

      {ov && ov.specs.length > 0 && (
        <>
          <h2 style={h2}>Specs</h2>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <tbody>
              {ov.specs.map((s, i) => (
                <tr key={i} className="keep" style={{ borderTop: i ? "1px solid #eef0f2" : undefined, verticalAlign: "top" }}>
                  <td style={{ padding: "4px 8px 4px 0", fontWeight: 600, width: "28%" }}>{s.label}</td>
                  <td style={{ padding: "4px 8px" }}>{s.value}</td>
                  <td style={{ padding: "4px 0", color: "#5b636d", width: "26%" }}>{s.source}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {ov && ov.key_dates.length > 0 && (<><h2 style={h2}>Dates</h2>{ov.key_dates.map((d, i) => <div key={i}><strong>{d.label}:</strong> {d.value}</div>)}</>)}
      {ov && ov.conditions.length > 0 && (<><h2 style={h2}>Conditions</h2><ul style={{ margin: 0, paddingLeft: 18 }}>{ov.conditions.map((c, i) => <li key={i}>{c}</li>)}</ul></>)}
      {ov && ov.exclusions.length > 0 && (<><h2 style={h2}>By others or excluded</h2><ul style={{ margin: 0, paddingLeft: 18 }}>{ov.exclusions.map((c, i) => <li key={i}>{c}</li>)}</ul></>)}

      {located && (
        <div className="keep">
          <h2 style={h2}>The street</h2>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
            {[0, 90, 180, 270].map((h) => <img key={h} src={`/api/quotes/${q.id}/streetview?h=${h}`} alt="" style={{ width: "100%", borderRadius: 4, display: "block" }} />)}
          </div>
        </div>
      )}

      {ov && ov.documents.length > 0 && (<><h2 style={h2}>Documents</h2>{ov.documents.map((d, i) => <div key={i} style={{ marginBottom: 3 }}><strong>{d.name}</strong> — {d.about}</div>)}</>)}
    </main>
  );
}
