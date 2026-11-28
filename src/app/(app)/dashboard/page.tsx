import Link from "next/link";
import { requireTenant } from "@/lib/tenant";
import { createClient } from "@/lib/supabase/server";
import { dashboard, type DashQuote } from "@/lib/dashboard";
import { MonthChart } from "./chart";

const RANGES = [{ key: "month", label: "This month" }, { key: "3m", label: "3 months" }, { key: "12m", label: "12 months" }] as const;
const money = (n: number) => `$${Math.round(n).toLocaleString("en-AU")}`;

/** How quoting is going: what's been quoted, sent, won and lost. */
export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ r?: string }> }) {
  const { r = "3m" } = await searchParams;
  const ctx = await requireTenant();
  const db = await createClient();
  const now = new Date();
  const since = r === "month" ? new Date(now.getFullYear(), now.getMonth(), 1) : r === "12m" ? new Date(now.getFullYear(), now.getMonth() - 11, 1) : new Date(now.getFullYear(), now.getMonth() - 2, 1);
  const yearAgo = new Date(now.getFullYear(), now.getMonth() - 11, 1);
  const { data } = await db.from("site_quotes").select("id, option_group, status, total_ex_gst, created_at, sent_at, accepted_at, customer_name, job_id")
    .eq("tenant_id", ctx.tenant.id).is("superseded_at", null).gte("created_at", yearAgo.toISOString()).limit(10000);
  const d = dashboard((data ?? []) as DashQuote[], since, now);

  const tiles = [
    { label: "Quoted", value: money(d.quoted), note: `${d.quotes} quote${d.quotes === 1 ? "" : "s"}${d.fromRfq ? `, ${d.fromRfq} from RFQs` : ""}` },
    { label: "Won", value: money(d.wonValue), note: `${d.won} job${d.won === 1 ? "" : "s"}` },
    { label: "Win rate", value: d.winRate == null ? "-" : `${Math.round(d.winRate * 100)}%`, note: `${d.won} won, ${d.lost} lost` },
    { label: "Waiting to hear", value: money(d.waitingValue), note: `${d.waiting} sent, not decided` },
    { label: "Average quote", value: d.avgQuote == null ? "-" : money(d.avgQuote), note: "ex GST" },
  ];

  return (
    <div className="page" style={{ maxWidth: 1180 }}>
      <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: 12 }}>
        <div><h1>Dashboard</h1><p className="sub">All amounts ex GST. A quote with options counts once.</p></div>
        <div className="row" style={{ gap: 6 }} role="tablist" aria-label="Period">
          {RANGES.map((x) => (
            <Link key={x.key} href={`/dashboard?r=${x.key}`} role="tab" aria-selected={r === x.key} className="btn"
              style={{ padding: "7px 14px", ...(r === x.key ? { background: "var(--bitumen)", color: "#fff", borderColor: "var(--bitumen)" } : {}) }}>{x.label}</Link>
          ))}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
        {tiles.map((t) => (
          <section key={t.label} className="card" style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <span className="sub" style={{ marginTop: 0, fontWeight: 600 }}>{t.label}</span>
            <span style={{ fontSize: 28, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{t.value}</span>
            <span className="sub" style={{ marginTop: 0 }}>{t.note}</span>
          </section>
        ))}
      </div>

      <section className="card">
        <h2 style={{ marginTop: 0 }}>Quoted and won, last 12 months</h2>
        <MonthChart months={d.months} />
      </section>

      <section className="card">
        <h2 style={{ marginTop: 0 }}>Customers</h2>
        {d.topCustomers.length === 0 ? <p className="sub">No quotes with a customer in this period.</p> : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
              <thead><tr style={{ textAlign: "left", color: "var(--muted)", fontSize: 12 }}><th style={{ padding: 8 }}>Customer</th><th style={{ padding: 8, textAlign: "right" }}>Quotes</th><th style={{ padding: 8, textAlign: "right" }}>Quoted</th><th style={{ padding: 8, textAlign: "right" }}>Won</th></tr></thead>
              <tbody>{d.topCustomers.map((c) => (
                <tr key={c.name} style={{ borderTop: "1px solid var(--line-soft)" }}>
                  <td style={{ padding: 8 }}><Link href={`/quotes?q=${encodeURIComponent(c.name)}`}>{c.name}</Link></td>
                  <td style={{ padding: 8, textAlign: "right" }}>{c.count}</td>
                  <td style={{ padding: 8, textAlign: "right" }}>{money(c.quoted)}</td>
                  <td style={{ padding: 8, textAlign: "right", fontWeight: 600 }}>{money(c.won)}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
