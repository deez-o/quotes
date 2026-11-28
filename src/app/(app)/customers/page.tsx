import Link from "next/link";
import { requireTenant } from "@/lib/tenant";
import { createClient } from "@/lib/supabase/server";
import { CustomerForm, type CustomerRow } from "./form";

const money = (n: number) => `$${Math.round(n).toLocaleString("en-AU")}`;

/** Everyone the company quotes for, with how much they've quoted and won. */
export default async function CustomersPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q = "" } = await searchParams;
  const ctx = await requireTenant();
  const db = await createClient();
  const [{ data: list }, { data: quotes }] = await Promise.all([
    db.from("customers").select("id, name, contact_name, email, phone, address, abn, notes").eq("tenant_id", ctx.tenant.id).order("name").limit(1000),
    db.from("site_quotes").select("customer_id, customer_name, status, total_ex_gst, option_group, id, created_at").eq("tenant_id", ctx.tenant.id).is("superseded_at", null).limit(5000),
  ]);
  const stats = new Map<string, { quotes: number; quoted: number; won: number; wonValue: number; last: string }>();
  for (const r of quotes ?? []) {
    if (r.option_group && r.option_group !== r.id && r.status !== "won") continue; // count each quote once (the option that won, or A)
    const key = (r.customer_id as string | null) ?? `name:${(r.customer_name ?? "").toLowerCase()}`;
    const s = stats.get(key) ?? { quotes: 0, quoted: 0, won: 0, wonValue: 0, last: "" };
    s.quotes++; s.quoted += Number(r.total_ex_gst ?? 0);
    if (r.status === "won") { s.won++; s.wonValue += Number(r.total_ex_gst ?? 0); }
    if (r.created_at > s.last) s.last = r.created_at;
    stats.set(key, s);
  }
  const needle = q.trim().toLowerCase();
  const rows = ((list ?? []) as CustomerRow[]).filter((c) => !needle || [c.name, c.contact_name, c.email].some((v) => v?.toLowerCase().includes(needle)));
  const canEdit = ctx.role !== "viewer";

  return (
    <div className="page" style={{ maxWidth: 1100 }}>
      <div>
        <h1>Customers</h1>
        <p className="sub">Everyone you quote for. Customers are added as you quote; pick them from the list on a quote to fill in their details.</p>
      </div>
      <form className="row" style={{ gap: 8 }}><input type="search" name="q" defaultValue={q} placeholder="Search customers" aria-label="Search customers" style={{ minWidth: 260 }} /></form>
      {canEdit && (
        <details className="card">
          <summary style={{ cursor: "pointer", fontWeight: 700 }}>+ Add a customer</summary>
          <div style={{ marginTop: 10 }}><CustomerForm c={null} canEdit={canEdit} /></div>
        </details>
      )}
      {rows.length === 0 ? (
        <div className="card"><p className="sub" style={{ margin: 0 }}>{needle ? "No customers match." : "No customers yet. They're added when you save a quote with a customer name."}</p></div>
      ) : rows.map((c) => {
        const s = stats.get(c.id) ?? stats.get(`name:${c.name.toLowerCase()}`);
        return (
          <details key={c.id} className="card">
            <summary style={{ cursor: "pointer", display: "flex", gap: 12, flexWrap: "wrap", alignItems: "baseline" }}>
              <strong style={{ fontSize: 16 }}>{c.name}</strong>
              <span className="sub" style={{ marginTop: 0 }}>{[c.contact_name, c.email, c.phone].filter(Boolean).join(" · ")}</span>
              <span className="grow" />
              {s && <span className="sub" style={{ marginTop: 0 }}>{s.quotes} quote{s.quotes === 1 ? "" : "s"} · {money(s.quoted)} quoted · {s.won} won ({money(s.wonValue)})</span>}
            </summary>
            <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 10 }}>
              <CustomerForm c={c} canEdit={canEdit} />
              <Link href={`/quotes?q=${encodeURIComponent(c.name)}`} className="sub" style={{ textDecoration: "underline" }}>See their quotes</Link>
            </div>
          </details>
        );
      })}
    </div>
  );
}
