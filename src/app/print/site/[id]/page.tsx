import { notFound } from "next/navigation";
import { requireTenant } from "@/lib/tenant";
import { createClient } from "@/lib/supabase/server";
import { money, type Priced } from "@/lib/site/price";
import { PrintButton } from "./print-button";

/** The customer's quote, laid out for A4. Save as PDF from the browser's print or share menu. */
export default async function PrintSiteQuote({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireTenant();
  const db = await createClient();
  const [{ data: q }, { data: tenant }, { data: settings }] = await Promise.all([
    db.from("site_quotes").select("quote_no, title, customer_name, customer_email, site_address, costing, created_at, updated_at")
      .eq("id", id).eq("tenant_id", ctx.tenant.id).maybeSingle(),
    db.from("tenants").select("name, abn").eq("id", ctx.tenant.id).maybeSingle(),
    db.from("tenant_settings").select("quote_terms, gst_percent").eq("tenant_id", ctx.tenant.id).maybeSingle(),
  ]);
  if (!q) notFound();
  const c = q.costing as Priced;
  const date = new Date(q.updated_at ?? q.created_at).toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric" });

  return (
    <main style={{ maxWidth: 780, margin: "0 auto", padding: "32px 28px", background: "#fff", minHeight: "100vh", color: "#1c1f23" }}>
      <style>{`@page { size: A4; margin: 16mm } @media print { .no-print { display: none !important } body { background: #fff } main { padding: 0 !important } }`}</style>
      <div className="no-print" style={{ display: "flex", justifyContent: "flex-end", marginBottom: 16 }}><PrintButton /></div>

      <header style={{ display: "flex", justifyContent: "space-between", gap: 24, borderBottom: "3px solid #c2410c", paddingBottom: 16 }}>
        <div>
          <div style={{ fontFamily: "var(--font-head)", fontSize: 26, fontWeight: 600 }}>{tenant?.name}</div>
          {tenant?.abn && <div style={{ fontSize: 13, color: "#5b6168" }}>ABN {tenant.abn}</div>}
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 22, fontWeight: 600 }}>Quote</div>
          <div style={{ fontSize: 14 }}>{q.quote_no}</div>
          <div style={{ fontSize: 14, color: "#5b6168" }}>{date}</div>
        </div>
      </header>

      <section style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24, margin: "20px 0", fontSize: 14 }}>
        <div><div style={{ color: "#5b6168", fontSize: 12, fontWeight: 600 }}>FOR</div>{q.customer_name ?? "-"}{q.customer_email && <div>{q.customer_email}</div>}</div>
        <div><div style={{ color: "#5b6168", fontSize: 12, fontWeight: 600 }}>SITE</div>{q.site_address ?? "-"}</div>
      </section>

      <h1 style={{ fontSize: 18, margin: "0 0 10px" }}>{q.title}</h1>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
        <thead>
          <tr style={{ textAlign: "left", borderBottom: "2px solid #1c1f23" }}>
            <th style={{ padding: "8px 4px" }}>Description</th>
            <th style={{ padding: "8px 4px", textAlign: "right" }}>Qty</th>
            <th style={{ padding: "8px 4px", textAlign: "right" }}>Rate</th>
            <th style={{ padding: "8px 4px", textAlign: "right" }}>Amount</th>
          </tr>
        </thead>
        <tbody>
          {(c.customerLines ?? []).map((l) => (
            <tr key={l.key} style={{ borderBottom: "1px solid #e3e1dc" }}>
              <td style={{ padding: "10px 4px" }}>{l.description}</td>
              <td style={{ padding: "10px 4px", textAlign: "right", whiteSpace: "nowrap" }}>{l.quantity.toLocaleString("en-AU")} {l.unit}</td>
              <td style={{ padding: "10px 4px", textAlign: "right" }}>{money(l.rate)}</td>
              <td style={{ padding: "10px 4px", textAlign: "right" }}>{money(l.total)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr><td colSpan={3} style={{ padding: "10px 4px", textAlign: "right", fontWeight: 600 }}>Total ex GST</td><td style={{ padding: "10px 4px", textAlign: "right", fontWeight: 600 }}>{money(c.priceExGst)}</td></tr>
          <tr><td colSpan={3} style={{ padding: "2px 4px", textAlign: "right" }}>GST ({settings?.gst_percent ?? 10}%)</td><td style={{ padding: "2px 4px", textAlign: "right" }}>{money(c.gst)}</td></tr>
          <tr><td colSpan={3} style={{ padding: "10px 4px", textAlign: "right", fontWeight: 600, fontSize: 16 }}>Total inc GST</td><td style={{ padding: "10px 4px", textAlign: "right", fontWeight: 600, fontSize: 16 }}>{money(c.priceIncGst)}</td></tr>
        </tfoot>
      </table>

      {settings?.quote_terms && (
        <section style={{ marginTop: 28, fontSize: 12, color: "#33383f", whiteSpace: "pre-wrap" }}>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>Terms</div>
          {settings.quote_terms}
        </section>
      )}
    </main>
  );
}
