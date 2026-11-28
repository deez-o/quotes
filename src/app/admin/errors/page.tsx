import { requireOwner } from "@/lib/owner";
import { createAdminClient } from "@/lib/supabase/admin";

const daysAgo = (n: number) => new Date(Date.now() - n * 86400_000).toISOString();

/** Recent errors across all companies, newest first, grouped by message. */
export default async function ErrorsPage() {
  await requireOwner();
  const admin = createAdminClient();
  const since = daysAgo(14);
  const [{ data: errors }, { data: tenants }] = await Promise.all([
    admin.from("app_errors").select("id, where_from, message, digest, path, tenant_id, created_at, detail").gte("created_at", since).order("created_at", { ascending: false }).limit(500),
    admin.from("tenants").select("id, name"),
  ]);
  const names = new Map((tenants ?? []).map((t) => [t.id as string, t.name as string]));
  const groups = new Map<string, { message: string; count: number; last: NonNullable<typeof errors>[number] }>();
  for (const e of errors ?? []) {
    const g = groups.get(e.message);
    if (g) g.count++; else groups.set(e.message, { message: e.message, count: 1, last: e });
  }
  return (
    <div className="page" style={{ maxWidth: 1100 }}>
      <div><h1>Errors</h1><p className="sub">The last 14 days. Set ALERT_EMAIL in Vercel to be emailed the first time an error shows up (at most once per 30 minutes for the same error).</p></div>
      {groups.size === 0 ? <div className="card"><p className="sub" style={{ margin: 0 }}>No errors in the last 14 days.</p></div> : [...groups.values()].map((g) => (
        <details key={g.message} className="card">
          <summary style={{ cursor: "pointer", display: "flex", gap: 10, flexWrap: "wrap" }}>
            <strong style={{ flex: 1, minWidth: 0, overflowWrap: "anywhere" }}>{g.message.slice(0, 200)}</strong>
            <span className="sub" style={{ marginTop: 0 }}>{g.count}× · {g.last.where_from} · last {new Date(g.last.created_at).toLocaleString("en-AU", { timeZone: "Australia/Brisbane" })}</span>
          </summary>
          <div className="sub" style={{ marginTop: 8 }}>Page: {g.last.path ?? "-"} · Company: {g.last.tenant_id ? names.get(g.last.tenant_id) ?? g.last.tenant_id : "-"} · Digest: {g.last.digest ?? "-"}</div>
          <pre style={{ whiteSpace: "pre-wrap", fontSize: 12, background: "#f5f6f7", padding: 10, borderRadius: 6, overflowX: "auto" }}>{JSON.stringify(g.last.detail, null, 2)}</pre>
        </details>
      ))}
    </div>
  );
}
