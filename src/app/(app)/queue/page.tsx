import { requireTenant } from "@/lib/tenant";
import { createClient } from "@/lib/supabase/server";

const CONFIDENCE_ORDER = { low: 0, medium: 1, high: 2 } as const;
const CONFIDENCE_BADGE = { low: "bad", medium: "warn", high: "good" } as const;
const SOURCE_LABEL = { inbox: "Inbox", forward: "Forwarded", upload: "Uploaded" } as const;

function formatDue(iso: string | null) {
  if (!iso) return "–";
  return new Intl.DateTimeFormat("en-AU", {
    weekday: "short", day: "numeric", month: "short", timeZone: "Australia/Brisbane",
  }).format(new Date(iso));
}

export default async function QueuePage({ searchParams }: { searchParams: Promise<{ sent?: string }> }) {
  const { sent } = await searchParams;
  const ctx = await requireTenant();
  const supabase = await createClient();

  const [{ data: jobs, error }, { data: mailbox }, { data: inProgress }] = await Promise.all([
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
      .in("provider", ["microsoft", "google"])
      .limit(1)
      .maybeSingle(),
    supabase
      .from("jobs")
      .select("id, quote_no, site, source, status, created_at")
      .eq("tenant_id", ctx.tenant.id)
      .eq("module", "quoting")
      .in("status", ["new", "processing"])
      .order("created_at", { ascending: false })
      .limit(20),
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

      {sent && (
        <p className="card" style={{ borderColor: "var(--good)", color: "var(--good)", fontWeight: 600 }}>
          Sent in. Quotr is filing it now; it appears under In progress within a minute or two.
        </p>
      )}

      {error && <p className="error">Couldn&apos;t load jobs: {error.message}</p>}

      {(inProgress?.length ?? 0) > 0 && (
        <section className="card">
          <h2>In progress · {inProgress!.length}</h2>
          <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {inProgress!.map((j) => (
              <li key={j.id} className="row" style={{ padding: "10px 0", borderBottom: "1px solid var(--line-soft)", gap: 12 }}>
                <strong style={{ width: 64 }}>{j.quote_no ?? "–"}</strong>
                <span className="grow">{j.site ?? "Untitled"}</span>
                <span className="badge quiet">{SOURCE_LABEL[j.source as keyof typeof SOURCE_LABEL] ?? "Inbox"}</span>
                <span className="sub" style={{ marginTop: 0 }}>{j.status === "processing" ? "Filing" : "Waiting for the draft step"}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {sorted.length === 0 ? (
        <div className="card">
          <h2>No drafts waiting</h2>
          <p className="sub">
            Use New quote to drag in or forward an RFQ, or connect your inbox in Setup to have them picked up automatically.
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
