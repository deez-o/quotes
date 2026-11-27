import { requireTenant } from "@/lib/tenant";
import { createClient } from "@/lib/supabase/server";
import { setRuleStatus } from "./actions";
import { RuleForm } from "./rule-form";

type Rule = { id: string; code: string; grp: string | null; text: string; status: string; source: string; always_on: boolean; why: string | null };

function RuleButton({ id, status, label, dark }: { id: string; status: string; label: string; dark?: boolean }) {
  return (
    <form action={setRuleStatus}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="status" value={status} />
      <button type="submit" className={`btn${dark ? " dark" : ""}`} style={{ padding: "8px 12px" }}>{label}</button>
    </form>
  );
}

export default async function TeachPage() {
  const ctx = await requireTenant();
  const supabase = await createClient();
  const isAdmin = ctx.role === "admin";

  const { data, error } = await supabase
    .from("rules")
    .select("id, code, grp, text, status, source, always_on, why")
    .eq("tenant_id", ctx.tenant.id)
    .eq("module", "quoting")
    .neq("source", "starter")
    .in("status", ["proposed", "active", "off"])
    .order("created_at", { ascending: true });

  const rules = (data ?? []) as Rule[];
  const byNumber = (a: Rule, b: Rule) => Number(a.code.slice(1)) - Number(b.code.slice(1));
  const proposed = rules.filter((r) => r.status === "proposed").sort(byNumber);
  const live = rules.filter((r) => r.status !== "proposed").sort(byNumber);
  const groups: [string, Rule[]][] = [];
  for (const r of live) {
    const g = r.grp ?? "Your own rules";
    const found = groups.find(([name]) => name === g);
    if (found) found[1].push(r);
    else groups.push([g, [r]]);
  }

  return (
    <div className="page">
      <div>
        <h1>Teach Quotr</h1>
        <p className="sub">
          Your own way of quoting, in plain English. Your rules apply to every quote from now on and come first. Switch one off any time.
        </p>
      </div>

      {ctx.role !== "viewer" && <RuleForm />}

      {error && <p className="error">Couldn&apos;t load rules: {error.message}</p>}

      {proposed.length > 0 && <section className="card">
        <h2>Suggested by Quotr · {proposed.length}</h2>
        {proposed.length === 0 ? (
          <p className="sub" style={{ marginTop: 0 }}>Nothing waiting.</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {proposed.map((r) => (
              <div key={r.id} className="row" style={{ border: "1px solid var(--line)", borderRadius: 10, padding: "12px 16px" }}>
                <div className="grow">
                  <div style={{ fontWeight: 600 }}>{r.code} · {r.text}</div>
                  {r.why && <div className="sub" style={{ marginTop: 2, fontSize: 13 }}>{r.why}</div>}
                </div>
                {isAdmin && (
                  <div className="row" style={{ gap: 8 }}>
                    <RuleButton id={r.id} status="active" label="Approve" dark />
                    <RuleButton id={r.id} status="rejected" label="Reject" />
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>}

      <section className="card">
        <h2>Your rules · {live.filter((r) => r.status === "active").length} active</h2>
        {live.length === 0 && <p className="sub" style={{ marginTop: 0 }}>None yet. Quotr uses its standard method until you add your own.</p>}
        {groups.map(([grp, items]) => (
          <div key={grp} style={{ marginTop: 12 }}>
            <h3 style={{ fontSize: 13, fontWeight: 600, color: "var(--muted)", margin: "8px 0 0", textTransform: "uppercase", letterSpacing: 0.4 }}>{grp}</h3>
            <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
              {items.map((r) => (
                <li key={r.id} className="row" style={{ padding: "10px 0", borderBottom: "1px solid var(--line-soft)", gap: 12 }}>
                  <span className="sub" style={{ marginTop: 0, width: 36 }}>{r.code}</span>
                  <span className="grow" style={{ color: r.status === "off" ? "var(--muted)" : undefined }}>{r.text}</span>
                  {r.always_on ? (
                    <span className="badge quiet">Always on</span>
                  ) : r.status === "off" ? (
                    isAdmin ? <RuleButton id={r.id} status="active" label="Switch on" /> : <span className="badge quiet">Off</span>
                  ) : isAdmin ? (
                    <RuleButton id={r.id} status="off" label="Switch off" />
                  ) : (
                    <span className="badge good">On</span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </section>
    </div>
  );
}
