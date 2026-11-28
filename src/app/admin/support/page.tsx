import { requireOwner } from "@/lib/owner";
import { createAdminClient } from "@/lib/supabase/admin";
import { revalidatePath } from "next/cache";

async function close(f: FormData) {
  "use server";
  await requireOwner();
  const id = String(f.get("id") ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(id)) return;
  await createAdminClient().from("support_requests").update({ status: f.get("reopen") ? "open" : "closed" }).eq("id", id);
  revalidatePath("/admin/support");
}

/** Help requests from inside the app, and companies asking to close. */
export default async function SupportPage() {
  await requireOwner();
  const admin = createAdminClient();
  const [{ data: reqs }, { data: tenants }] = await Promise.all([
    admin.from("support_requests").select("id, tenant_id, email, topic, message, page, status, created_at").order("created_at", { ascending: false }).limit(200),
    admin.from("tenants").select("id, name, close_requested_at, close_reason"),
  ]);
  const names = new Map((tenants ?? []).map((t) => [t.id as string, t.name as string]));
  const closing = (tenants ?? []).filter((t) => t.close_requested_at);
  return (
    <div className="page" style={{ maxWidth: 1000 }}>
      <div><h1>Help requests</h1><p className="sub">Reply by email. Set SUPPORT_EMAIL in Vercel to get each one in your inbox.</p></div>
      {closing.length > 0 && (
        <section className="card" style={{ background: "var(--warn-bg)" }}>
          <h2 style={{ marginTop: 0 }}>Asked to close</h2>
          {closing.map((t) => <div key={t.id}><strong>{t.name}</strong> on {new Date(t.close_requested_at!).toLocaleDateString("en-AU")}{t.close_reason ? `: ${t.close_reason}` : ""}. Delete their data 30 days after their paid period ends.</div>)}
        </section>
      )}
      {(reqs ?? []).length === 0 ? <div className="card"><p className="sub" style={{ margin: 0 }}>No help requests yet.</p></div> : (reqs ?? []).map((r) => (
        <section key={r.id} className="card" style={{ opacity: r.status === "closed" ? 0.6 : 1 }}>
          <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
            <strong>{r.topic} · {names.get(r.tenant_id) ?? "?"}</strong>
            <span className="sub" style={{ marginTop: 0 }}>{r.email ? <a href={`mailto:${r.email}`}>{r.email}</a> : "-"} · {new Date(r.created_at).toLocaleString("en-AU", { timeZone: "Australia/Brisbane" })}</span>
          </div>
          <p style={{ whiteSpace: "pre-wrap" }}>{r.message}</p>
          <form action={close} className="row" style={{ gap: 8, alignItems: "center" }}>
            <input type="hidden" name="id" value={r.id} />
            {r.status === "closed" && <input type="hidden" name="reopen" value="1" />}
            <button type="submit" className="btn">{r.status === "closed" ? "Reopen" : "Mark done"}</button>
            {r.page && <span className="sub" style={{ marginTop: 0 }}>From {r.page}</span>}
          </form>
        </section>
      ))}
    </div>
  );
}
