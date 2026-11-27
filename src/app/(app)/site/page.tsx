import Link from "next/link";
import { requireTenant } from "@/lib/tenant";
import { createClient } from "@/lib/supabase/server";
import { money } from "@/lib/site/price";

const STATUS = { draft: "quiet", sent: "warn", won: "good", lost: "bad" } as const;

export default async function SiteQuotesPage() {
  const ctx = await requireTenant();
  const db = await createClient();
  const { data: quotes } = await db.from("site_quotes")
    .select("id, quote_no, title, customer_name, status, total_ex_gst, created_at")
    .eq("tenant_id", ctx.tenant.id).order("created_at", { ascending: false }).limit(100);

  return (
    <div className="page" style={{ maxWidth: 760 }}>
      <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-end" }}>
        <div>
          <h1>Site quotes</h1>
          <p className="sub">Talk about a job on site and get a priced quote from your own costs.</p>
        </div>
        {ctx.role !== "viewer" && <Link href="/site/new" className="btn primary">New site quote</Link>}
      </div>

      {(quotes ?? []).length === 0 ? (
        <div className="card">
          <h2>No site quotes yet</h2>
          <p className="sub" style={{ marginTop: 0 }}>Tap New site quote on your phone at the job, talk about it and take a few photos.</p>
        </div>
      ) : (
        <ul className="card" style={{ listStyle: "none", margin: 0, padding: "4px 20px" }}>
          {quotes!.map((q) => (
            <li key={q.id} style={{ borderBottom: "1px solid var(--line-soft)" }}>
              <Link href={`/site/${q.id}`} className="row" style={{ padding: "14px 0", gap: 12 }}>
                <strong style={{ width: 64 }}>{q.quote_no}</strong>
                <span className="grow">
                  <span style={{ fontWeight: 600 }}>{q.title ?? "Site quote"}</span>
                  <span className="sub" style={{ display: "block", marginTop: 0, fontSize: 13 }}>
                    {q.customer_name ?? "No customer yet"} · {new Date(q.created_at).toLocaleDateString("en-AU", { day: "numeric", month: "short" })}
                  </span>
                </span>
                <strong>{q.total_ex_gst != null ? money(Number(q.total_ex_gst)) : "–"}</strong>
                <span className={`badge ${STATUS[q.status as keyof typeof STATUS]}`}>{q.status}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
