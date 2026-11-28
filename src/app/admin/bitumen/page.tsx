import { revalidatePath } from "next/cache";
import { requireOwner } from "@/lib/owner";
import { createAdminClient } from "@/lib/supabase/admin";
import { monthName } from "@/lib/bitumen";

async function save(f: FormData) {
  "use server";
  await requireOwner();
  const month = String(f.get("month") ?? "");
  const value = Number(String(f.get("value") ?? "").replace(/[,$\s]/g, ""));
  if (!/^\d{4}-\d{2}$/.test(month) || !Number.isFinite(value) || value <= 0 || value > 10000) return;
  await createAdminClient().from("bitumen_indexes").upsert({ month: `${month}-01`, value, source: String(f.get("source") ?? "").slice(0, 200) || "TMR Qld bitumen price index", updated_at: new Date().toISOString() });
  revalidatePath("/admin/bitumen");
}

async function checkTmr() {
  "use server";
  await requireOwner();
  const { syncTmrIndex } = await import("@/lib/bitumen-sync");
  const r = await syncTmrIndex(createAdminClient());
  revalidatePath("/admin/bitumen");
  const { redirect } = await import("next/navigation");
  redirect(`/admin/bitumen?m=${encodeURIComponent(r.message)}`);
}

/** The monthly bitumen index every company's rise and fall uses. Update it when TMR publishes. */
export default async function BitumenPage({ searchParams }: { searchParams: Promise<{ m?: string }> }) {
  const { m } = await searchParams;
  await requireOwner();
  const { data } = await createAdminClient().from("bitumen_indexes").select("month, value, source").order("month", { ascending: false }).limit(36);
  return (
    <div className="page" style={{ maxWidth: 760 }}>
      <div>
        <h1>Bitumen index</h1>
        <p className="sub">$ per tonne, from TMR&apos;s monthly Bitumen Price Index. quoteout reads TMR&apos;s PDF every morning and adds new months by itself (you&apos;re emailed at ALERT_EMAIL when it does). You can also add or correct a month here.</p>
      </div>
      <form action={checkTmr} className="row" style={{ gap: 10, alignItems: "center" }}>
        <button type="submit" className="btn">Check TMR now</button>
        {m && <span className="sub" style={{ marginTop: 0 }} role="status">{m}</span>}
      </form>
      <form action={save} className="card row" style={{ gap: 8, alignItems: "end", flexWrap: "wrap" }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 4, fontWeight: 600, fontSize: 13 }}>Month<input type="month" name="month" required /></label>
        <label style={{ display: "flex", flexDirection: "column", gap: 4, fontWeight: 600, fontSize: 13 }}>$ per tonne<input name="value" inputMode="decimal" required placeholder="1878.59" /></label>
        <label style={{ display: "flex", flexDirection: "column", gap: 4, fontWeight: 600, fontSize: 13, flex: 1 }}>Source<input name="source" placeholder="TMR Qld bitumen price index" /></label>
        <button type="submit" className="btn primary">Save</button>
      </form>
      <div className="card" style={{ padding: 0 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
          <tbody>{(data ?? []).map((r) => (
            <tr key={r.month} style={{ borderTop: "1px solid var(--line-soft)" }}>
              <td style={{ padding: "8px 14px" }}>{monthName(r.month)}</td>
              <td style={{ padding: 8, textAlign: "right", fontWeight: 600 }}>${Number(r.value).toLocaleString("en-AU", { minimumFractionDigits: 2 })}</td>
              <td style={{ padding: "8px 14px" }} className="sub">{r.source}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
    </div>
  );
}
