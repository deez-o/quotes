import { AutoSave } from "../auto-save";
import { revalidatePath } from "next/cache";
import { requireTenant } from "@/lib/tenant";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendableMailbox } from "@/lib/mail/mailbox-send";
import { planFor } from "@/lib/plans";
import { msConfigFromEnv } from "@/lib/microsoft/oauth";
import { appUrl } from "@/lib/app-url";

async function setSendFromMailbox(f: FormData) {
  "use server";
  const ctx = await requireTenant();
  if (ctx.role !== "admin") return;
  const db = await createClient();
  await db.from("tenant_settings").update({ send_from_mailbox: f.get("on") === "on" }).eq("tenant_id", ctx.tenant.id);
  revalidatePath("/setup");
}

/** Business: the company's Outlook inbox, for picking up RFQs and sending quotes from their own address. */
export async function OutlookCard({ tenantId, plan, isAdmin }: { tenantId: string; plan: string | null; isAdmin: boolean }) {
  const p = planFor(plan);
  const admin = createAdminClient();
  const [mb, { data: s }] = await Promise.all([
    sendableMailbox(admin, tenantId),
    admin.from("tenant_settings").select("send_from_mailbox").eq("tenant_id", tenantId).maybeSingle(),
  ]);
  const ready = Boolean(msConfigFromEnv(appUrl()));
  return (
    <section id="outlook" className="card" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <h2 style={{ margin: 0 }}>Your Outlook inbox</h2>
      {!p.connectedMailbox ? (
        <p className="sub" style={{ margin: 0 }}>With Business, connect your Microsoft 365 inbox: RFQs that arrive there are picked up automatically, and quotes are sent from your own email address and kept in your Sent Items. <a href="/billing">See plans</a></p>
      ) : !mb ? (
        <>
          <p style={{ margin: 0 }}>Connect your Microsoft 365 inbox so RFQs that arrive there are picked up automatically, and quotes go out from your own email address.</p>
          {isAdmin ? (ready
            ? <div><a className="btn primary" href="/api/connect/microsoft">Connect Outlook</a></div>
            : <p className="sub" style={{ margin: 0 }}>Connecting Outlook is coming soon.</p>)
            : <p className="sub" style={{ margin: 0 }}>Ask a client admin to connect it.</p>}
        </>
      ) : (
        <>
          <p style={{ margin: 0 }}>Connected: <strong>{mb.email}</strong></p>
          {mb.canSend ? (
            <form action={setSendFromMailbox} className="row" style={{ gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <label style={{ display: "flex", gap: 8, alignItems: "center", fontWeight: 600 }}>
                <input type="checkbox" name="on" defaultChecked={Boolean(s?.send_from_mailbox)} disabled={!isAdmin} />
                Send quotes from {mb.email}
              </label>
              {isAdmin && <AutoSave />}
              <span className="sub" style={{ marginTop: 0, flexBasis: "100%" }}>Quotes come from your own address and are kept in your Sent Items. If Outlook can&apos;t send, quoteout sends it instead and tells you.</span>
            </form>
          ) : (
            <p className="sub" style={{ margin: 0 }}>To send quotes from this address, {isAdmin ? <a href="/api/connect/microsoft">reconnect Outlook</a> : "ask a client admin to reconnect Outlook"} and allow sending.</p>
          )}
        </>
      )}
    </section>
  );
}
