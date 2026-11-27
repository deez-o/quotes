import Link from "next/link";
import { requireTenant } from "@/lib/tenant";
import { createClient } from "@/lib/supabase/server";
import { money } from "@/lib/site/price";
import { DeleteQuote } from "./delete-button";

type Row = {
  kind: "site" | "rfq"; id: string; no: string | null; title: string; customer: string | null;
  source: string; status: string; total: number | null; at: string; href: string | null;
};

const SOURCE = { site: "Quick quote", inbox: "Inbox", forward: "Forwarded", upload: "Imported" } as const;
const STATUS_LABEL: Record<string, string> = {
  draft: "Draft", sent: "Sent", won: "Won", lost: "Lost",
  new: "Queued", processing: "Processing", drafted: "Ready for review", needs_attention: "Action required",
  approved: "Approved", filed: "Filed",
};
const STATUS_BADGE: Record<string, string> = {
  draft: "quiet", sent: "warn", won: "good", lost: "bad", new: "quiet", processing: "quiet",
  drafted: "good", needs_attention: "bad", approved: "good", filed: "quiet",
};
const FILTERS = [
  { key: "all", label: "All quotes" },
  { key: "check", label: "Awaiting review" },
  { key: "site", label: "Quick quotes" },
  { key: "rfq", label: "RFQs" },
  { key: "open", label: "Not yet sent" },
] as const;

export default async function QuotesPage({ searchParams }: { searchParams: Promise<{ show?: string; q?: string; sent?: string }> }) {
  const { show = "all", q = "", sent } = await searchParams;
  const ctx = await requireTenant();
  const db = await createClient();
  const t = ctx.tenant.id;

  const [{ data: siteAll }, { data: jobs }, { data: mailbox }] = await Promise.all([
    db.from("site_quotes")
      .select("id, quote_no, title, customer_name, status, total_ex_gst, created_at, job_id")
      .eq("tenant_id", t).order("created_at", { ascending: false }).limit(300),
    show === "site" ? Promise.resolve({ data: [] }) : db.from("jobs")
      .select("id, quote_no, customer_name, site, job_type, status, source, created_at")
      .eq("tenant_id", t).eq("module", "quoting").order("created_at", { ascending: false }).limit(200),
    db.from("connections").select("status, account_email").eq("tenant_id", t).eq("purpose", "mailbox")
      .in("provider", ["microsoft", "google"]).limit(1).maybeSingle(),
  ]);
  // An RFQ that has been drafted opens its quote; quick quotes are the ones not made from an RFQ.
  const draftFor = new Map((siteAll ?? []).filter((s) => s.job_id).map((s) => [s.job_id as string, s]));
  const site = show === "rfq" ? [] : (siteAll ?? []).filter((s) => !s.job_id);

  let rows: Row[] = [
    ...site.map((s) => ({
      kind: "site" as const, id: s.id, no: s.quote_no, title: s.title ?? "Quote", customer: s.customer_name,
      source: SOURCE.site, status: s.status, total: s.total_ex_gst == null ? null : Number(s.total_ex_gst), at: s.created_at, href: `/site/${s.id}`,
    })),
    ...(jobs ?? []).map((j) => {
      const d = draftFor.get(j.id);
      return {
        kind: "rfq" as const, id: j.id, no: j.quote_no, title: d?.title ?? j.site ?? j.job_type ?? "RFQ", customer: d?.customer_name ?? j.customer_name,
        source: SOURCE[(j.source ?? "inbox") as keyof typeof SOURCE] ?? "RFQ",
        status: d && d.status !== "draft" ? d.status : j.status,
        total: d?.total_ex_gst == null ? null : Number(d.total_ex_gst), at: j.created_at, href: d ? `/site/${d.id}` : null,
      };
    }),
  ].sort((a, b) => b.at.localeCompare(a.at));

  if (show === "check") rows = rows.filter((r) => ["drafted", "needs_attention", "draft"].includes(r.status));
  if (show === "open") rows = rows.filter((r) => !["sent", "won", "lost", "filed"].includes(r.status));
  const needle = q.trim().toLowerCase();
  if (needle) rows = rows.filter((r) => [r.no, r.title, r.customer].some((v) => v?.toLowerCase().includes(needle)));
  const canEdit = ctx.role !== "viewer";

  return (
    <div className="page" style={{ maxWidth: 1180 }}>
      <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-end", gap: 12 }}>
        <div>
          <h1>Quotes</h1>
          <p className="sub">
            All your quotes in one place: quick quotes and RFQs.{" "}
            {mailbox?.status === "ok" ? `Watching ${mailbox.account_email ?? "your inbox"} for new RFQs.` : <Link href="/setup" style={{ textDecoration: "underline" }}>Connect your inbox</Link>}
          </p>
        </div>
        {canEdit && (
          <div className="row" style={{ gap: 8 }}>
            <Link href="/start" className="btn primary">New Quote</Link>
          </div>
        )}
      </div>

      {sent && <p className="card" style={{ background: "var(--good-bg)", borderColor: "transparent", color: "var(--good)", fontWeight: 600 }}>RFQ received. It&apos;s being processed now and will show as &quot;Ready for review&quot; when the draft is done.</p>}

      <form className="row" style={{ gap: 8, justifyContent: "space-between" }}>
        <div className="row" style={{ gap: 6 }} role="tablist" aria-label="Show">
          {FILTERS.map((f) => (
            <Link key={f.key} href={`/quotes?show=${f.key}${q ? `&q=${encodeURIComponent(q)}` : ""}`} role="tab" aria-selected={show === f.key}
              className="btn" style={{ padding: "7px 14px", ...(show === f.key ? { background: "var(--bitumen)", color: "#fff", borderColor: "var(--bitumen)" } : {}) }}>
              {f.label}
            </Link>
          ))}
        </div>
        <input type="hidden" name="show" value={show} />
        <input type="search" name="q" defaultValue={q} placeholder="Search number, job or customer" aria-label="Search quotes" style={{ minWidth: 260 }} />
      </form>

      {rows.length === 0 ? (
        <div className="card">
          <h2>{needle || show !== "all" ? "Nothing matches" : "No quotes yet"}</h2>
          <p className="sub" style={{ marginTop: 0 }}>Use New Quote to start a quick quote, import an RFQ or paste an email.</p>
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
            <thead>
              <tr style={{ textAlign: "left", color: "var(--muted)", fontSize: 12 }}>
                <th style={{ padding: "12px 16px" }}>No.</th><th style={{ padding: 12 }}>Job</th><th style={{ padding: 12 }}>From</th>
                <th style={{ padding: 12 }}>Status</th><th style={{ padding: 12, textAlign: "right" }}>Price ex GST</th><th style={{ padding: 12 }}>Date</th>
                {canEdit && <th style={{ padding: "12px 16px" }} />}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.kind}-${r.id}`} style={{ borderTop: "1px solid var(--line-soft)" }}>
                  <td style={{ padding: "12px 16px", fontWeight: 600, whiteSpace: "nowrap" }}>{r.no ?? "–"}</td>
                  <td style={{ padding: 12, minWidth: 220 }}>
                    {r.href ? <Link href={r.href} style={{ fontWeight: 600 }}>{r.title}</Link> : <span style={{ fontWeight: 600 }}>{r.title}</span>}
                    <span className="sub" style={{ display: "block", marginTop: 0, fontSize: 13 }}>{r.customer ?? "No customer yet"}</span>
                  </td>
                  <td style={{ padding: 12, whiteSpace: "nowrap" }}>{r.source}</td>
                  <td style={{ padding: 12 }}><span className={`badge ${STATUS_BADGE[r.status] ?? "quiet"}`}>{STATUS_LABEL[r.status] ?? r.status}</span></td>
                  <td style={{ padding: 12, textAlign: "right", fontWeight: 600, whiteSpace: "nowrap" }}>{r.total != null ? money(r.total) : "–"}</td>
                  <td style={{ padding: 12, whiteSpace: "nowrap", color: "var(--muted)" }}>
                    {new Date(r.at).toLocaleDateString("en-AU", { day: "numeric", month: "short", timeZone: "Australia/Brisbane" })}
                  </td>
                  {canEdit && <td style={{ padding: "8px 16px", textAlign: "right" }}><DeleteQuote kind={r.kind} id={r.id} label={r.no ?? r.title} /></td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
