import Link from "next/link";
import { requireTenant } from "@/lib/tenant";
import { createClient } from "@/lib/supabase/server";
import { dashboard, type DashQuote } from "@/lib/dashboard";
import { MonthChart } from "./chart";
import { market, type MarketQuote } from "@/lib/market";
import { onePerQuote } from "@/lib/dashboard";

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

  // The market: where, which mixes, what margin and size you win at (this period).
  const keep = new Set(onePerQuote((data ?? []) as DashQuote[]).filter((x) => new Date(x.created_at) >= since).map((x) => x.id));
  const [{ data: mq }, { data: mixRows }] = await Promise.all([
    keep.size ? db.from("site_quotes").select("id, status, created_at, site_address, total_ex_gst, costing, scope").eq("tenant_id", ctx.tenant.id).in("id", [...keep].slice(0, 2000)) : Promise.resolve({ data: [] }),
    db.from("cost_items").select("id, name").eq("tenant_id", ctx.tenant.id),
  ]);
  const mixNames = new Map((mixRows ?? []).map((c) => [c.id as string, c.name as string]));
  const mk = market((mq ?? []) as MarketQuote[], (id) => mixNames.get(id) ?? null);
  const pctM = (n: number | null) => (n == null ? "–" : `${n.toFixed(1)}%`);
  const t0 = (n: number) => `${Math.round(n).toLocaleString("en-AU")} t`;
  const perT = (n: number | null) => (n == null ? "–" : `$${n.toFixed(2)}`);

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

      <h2 style={{ margin: "10px 0 0" }}>The market</h2>
      <p className="sub" style={{ marginTop: 0 }}>Win rate is won ÷ (won + lost): quotes still waiting don&apos;t count. {mk.decided ? `${mk.decided} decided quote${mk.decided === 1 ? "" : "s"} in this period.` : "Mark quotes won or lost (or have customers accept online) and this fills in."}</p>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
        {[
          { label: "Tonnes quoted", value: t0(mk.tonnesQuoted), note: `${t0(mk.tonnesWon)} won` },
          { label: "Margin you win at", value: pctM(mk.marginWon), note: `lost ones averaged ${pctM(mk.marginLost)}` },
          { label: "$/t on wins", value: perT(mk.perTonneWon), note: `lost ones averaged ${perT(mk.perTonneLost)}` },
        ].map((t) => (
          <section key={t.label} className="card" style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <span className="sub" style={{ marginTop: 0, fontWeight: 600 }}>{t.label}</span>
            <span style={{ fontSize: 28, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{t.value}</span>
            <span className="sub" style={{ marginTop: 0 }}>{t.note}</span>
          </section>
        ))}
      </div>

      <section className="card">
        <h2 style={{ marginTop: 0 }}>Mixes</h2>
        {mk.mixes.length === 0 ? <p className="sub">No asphalt priced by the tonne in this period.</p> : (
          <div style={{ overflowX: "auto" }}>
            <table className="dash-table">
              <thead><tr><th>Mix</th><th>Tonnes quoted</th><th>Tonnes won</th><th>Win rate</th><th>$/t quoted</th><th>$/t won</th><th>$/t lost</th></tr></thead>
              <tbody>{mk.mixes.map((x) => (
                <tr key={x.mix}><td>{x.mix}</td><td>{t0(x.tonnesQuoted)}</td><td>{t0(x.tonnesWon)}</td><td><WinBar r={x.winRate} n={x.won + x.lost} /></td><td>{perT(x.rateQuoted)}</td><td style={{ fontWeight: 600 }}>{perT(x.rateWon)}</td><td>{perT(x.rateLost)}</td></tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card">
        <h2 style={{ marginTop: 0 }}>Where you win</h2>
        {mk.areas.length === 0 ? <p className="sub">No site addresses on quotes in this period.</p> : (
          <div style={{ overflowX: "auto" }}>
            <table className="dash-table">
              <thead><tr><th>Suburb</th><th>Quotes</th><th>Win rate</th><th>Won</th><th>Margin won at</th></tr></thead>
              <tbody>{mk.areas.map((x) => (
                <tr key={x.area}><td>{x.area}</td><td>{x.quotes}</td><td><WinBar r={x.winRate} n={x.won + x.lost} /></td><td style={{ fontWeight: 600 }}>{money(x.wonValue)}</td><td>{pctM(x.marginWon)}</td></tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </section>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 12 }}>
        {[{ title: "Win rate by margin", rows: mk.margins }, { title: "Win rate by job size", rows: mk.sizes }].map((g) => (
          <section key={g.title} className="card">
            <h2 style={{ marginTop: 0 }}>{g.title}</h2>
            <table className="dash-table">
              <thead><tr><th>{g.title.endsWith("margin") ? "Margin" : "Asphalt"}</th><th>Quotes</th><th>Win rate</th></tr></thead>
              <tbody>{g.rows.map((b) => <tr key={b.band}><td>{b.band}</td><td>{b.quotes}</td><td><WinBar r={b.winRate} n={b.won + b.lost} /></td></tr>)}</tbody>
            </table>
          </section>
        ))}
      </div>

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

/** Win rate as a bar and a number, with how many decided quotes it's based on. */
function WinBar({ r, n }: { r: number | null; n: number }) {
  if (r == null) return <span className="sub" style={{ marginTop: 0 }}>none decided</span>;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8, minWidth: 150 }}>
      <span aria-hidden style={{ flex: "0 0 70px", height: 8, borderRadius: 4, background: "var(--line-soft, #eef0f2)", overflow: "hidden" }}>
        <span style={{ display: "block", height: "100%", width: `${Math.round(r * 100)}%`, background: "var(--bitumen, #16181B)", borderRadius: 4 }} />
      </span>
      <span style={{ fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{Math.round(r * 100)}%</span>
      <span className="sub" style={{ marginTop: 0, fontSize: 12 }}>of {n}</span>
    </span>
  );
}
