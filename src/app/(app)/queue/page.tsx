import { requireTenant } from "@/lib/tenant";
import { createClient } from "@/lib/supabase/server";

const CONFIDENCE_ORDER = { low: 0, medium: 1, high: 2 } as const;
const CONFIDENCE_BADGE = { low: "bad", medium: "warn", high: "good" } as const;

function formatDue(iso: string | null) {
  if (!iso) return "–";
  return new Intl.DateTimeFormat("en-AU", {
    weekday: "short", day: "numeric", month: "short", timeZone: "Australia/Brisbane",
  }).format(new Date(iso));
}

export default async function QueuePage() {
  const ctx = await requireTenant();
  const supabase = await createClient();

  const [{ data: jobs, error }, { data: mailbox }] = await Promise.all([
    supabase
      .from("jobs")
      .select("id, quote_no, customer_name, site, job_type, due_at, confidence, flag_count, status")
      .eq("tenant_id", ctx.tenant.id)
      .eq("module", "quoting")
      .in("status", ["drafted", "needs_attention"])
      .order("created_at", { ascending: false })
      .limit(100),
    supabase
      .from("connections")
      .select("status, last_ok_at, account_email")
      .eq("tenant_id", ctx.tenant.id)
      .eq("purpose", "mailbox")
      .maybeSingle(),
  ]);

  const sorted = (jobs ?? []).sort(
    (a, b) =>
      (CONFIDENCE_ORDER[a.confidence as keyof typeof CONFIDENCE_ORDER] ?? 0) -
      (CONFIDENCE_ORDER[b.confidence as keyof typeof CONFIDENCE_ORDER] ?? 0),
  );

  return (
    <div className="page">
      <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-end" }}>
        <div>
          <h1>RFQ queue</h1>
          <p className="sub">Lowest confidence first. Every draft waits for you to check and send.</p>
        </div>
        {mailbox?.status === "ok" ? (
          <span className="badge good">Inbox connected</span>
        ) : (
          <span className="badge quiet">Inbox not connected yet</span>
        )}
      </div>

      {error && <p className="error">Couldn&apos;t load jobs: {error.message}</p>}

      {sorted.length === 0 ? (
        <div className="card">
          <h2>No drafts waiting</h2>
          <p className="sub">
            New RFQs will appear here a few minutes after they arrive, once your inbox is connected in Setup.
          </p>
        </div>
      ) : (
        <div className="card scroll" style={{ padding: 0 }}>
          <table className="list" style={{ minWidth: 760 }}>
            <thead>
              <tr>
                <th style={{ paddingLeft: 20 }}>Quote</th>
                <th>Customer and site</th>
                <th>Job type</th>
                <th>Due</th>
                <th>Confidence</th>
                <th>To check</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((j) => (
                <tr key={j.id}>
                  <td style={{ paddingLeft: 20, fontWeight: 600 }}>{j.quote_no ?? "–"}</td>
                  <td>
                    <div style={{ fontWeight: 600 }}>{j.customer_name ?? "Unknown customer"}</div>
                    <div className="sub" style={{ marginTop: 0 }}>{j.site ?? ""}</div>
                  </td>
                  <td>{j.job_type ?? "–"}</td>
                  <td>{formatDue(j.due_at)}</td>
                  <td>
                    {j.confidence ? (
                      <span className={`badge ${CONFIDENCE_BADGE[j.confidence as keyof typeof CONFIDENCE_BADGE]}`}>
                        {j.confidence[0].toUpperCase() + j.confidence.slice(1)}
                      </span>
                    ) : (
                      "–"
                    )}
                  </td>
                  <td>
                    {j.status === "needs_attention"
                      ? "Needs attention"
                      : j.flag_count === 0
                        ? "Ready to check"
                        : `${j.flag_count} flag${j.flag_count === 1 ? "" : "s"}`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
