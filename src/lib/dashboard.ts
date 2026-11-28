/** Numbers for the dashboard, worked out in code from the company's quotes. Pure, so it can be tested. */
export type DashQuote = { id: string; option_group: string | null; status: string; total_ex_gst: number | null; created_at: string; sent_at: string | null; accepted_at: string | null; customer_name: string | null; job_id: string | null };

export type Dash = {
  quotes: number; quoted: number; sent: number; won: number; wonValue: number; lost: number; waiting: number; waitingValue: number;
  winRate: number | null; avgQuote: number | null; fromRfq: number;
  months: { key: string; label: string; quoted: number; won: number; count: number }[];
  topCustomers: { name: string; won: number; quoted: number; count: number }[];
};

const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

/** One row per quote: a quote with options counts once, at the option that won (or Option A). */
export function onePerQuote(rows: DashQuote[]): DashQuote[] {
  const groups = new Map<string, DashQuote[]>();
  const out: DashQuote[] = [];
  for (const r of rows) {
    if (!r.option_group) out.push(r);
    else groups.set(r.option_group, [...(groups.get(r.option_group) ?? []), r]);
  }
  for (const [gid, g] of groups) out.push(g.find((x) => x.status === "won") ?? g.find((x) => x.id === gid) ?? g[0]);
  return out;
}

export function dashboard(rows: DashQuote[], since: Date, now = new Date()): Dash {
  const all = onePerQuote(rows);
  const inRange = all.filter((r) => new Date(r.created_at) >= since);
  const v = (r: DashQuote) => Number(r.total_ex_gst ?? 0);
  const won = inRange.filter((r) => r.status === "won");
  const lost = inRange.filter((r) => r.status === "lost");
  const waiting = inRange.filter((r) => r.status === "sent");
  const decided = won.length + lost.length;

  const months: Dash["months"] = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({ key: monthKey(d), label: d.toLocaleDateString("en-AU", { month: "short" }), quoted: 0, won: 0, count: 0 });
  }
  const byKey = new Map(months.map((m) => [m.key, m]));
  for (const r of all) {
    const m = byKey.get(monthKey(new Date(r.created_at)));
    if (!m) continue;
    m.quoted += v(r); m.count++;
    if (r.status === "won") m.won += v(r);
  }

  const cust = new Map<string, Dash["topCustomers"][number]>();
  for (const r of inRange) {
    const name = r.customer_name?.trim();
    if (!name) continue;
    const c = cust.get(name.toLowerCase()) ?? { name, won: 0, quoted: 0, count: 0 };
    c.quoted += v(r); c.count++;
    if (r.status === "won") c.won += v(r);
    cust.set(name.toLowerCase(), c);
  }

  return {
    quotes: inRange.length, quoted: inRange.reduce((s, r) => s + v(r), 0),
    sent: inRange.filter((r) => r.sent_at || ["sent", "won", "lost"].includes(r.status)).length,
    won: won.length, wonValue: won.reduce((s, r) => s + v(r), 0), lost: lost.length,
    waiting: waiting.length, waitingValue: waiting.reduce((s, r) => s + v(r), 0),
    winRate: decided ? won.length / decided : null, avgQuote: inRange.length ? inRange.reduce((s, r) => s + v(r), 0) / inRange.length : null,
    fromRfq: inRange.filter((r) => r.job_id).length,
    months,
    topCustomers: [...cust.values()].sort((a, b) => b.won - a.won || b.quoted - a.quoted).slice(0, 8),
  };
}
