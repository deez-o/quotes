import Link from "next/link";
import { requireTenant } from "@/lib/tenant";
import { createClient } from "@/lib/supabase/server";
import { NewQuoteForm } from "./form";

export default async function NewQuotePage() {
  const ctx = await requireTenant();
  const supabase = await createClient();
  const { data: inbound } = await supabase
    .from("inbound_addresses")
    .select("local_part")
    .eq("tenant_id", ctx.tenant.id)
    .maybeSingle();
  const domain = process.env.INBOUND_DOMAIN;
  const forwardTo = inbound && domain ? `${inbound.local_part}@${domain}` : null;

  return (
    <div className="page" style={{ maxWidth: 900 }}>
      <div>
        <Link href="/start" className="btn back-btn">← Back to New Quote</Link>
        <h1>Import an RFQ</h1>
        <p className="sub">Forward it, drag it in, or paste it. quoteout reads the email and its files, files the job and drafts the quote for you to check.</p>
      </div>

      <section className="card" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <h2 style={{ margin: 0 }}>Forward it from your email</h2>
        {forwardTo ? (
          <>
            <p style={{ margin: 0 }}>Forward the RFQ, attachments and all, to <strong style={{ userSelect: "all" }}>{forwardTo}</strong></p>
            <p className="sub" style={{ marginTop: 0 }}>
              Works from Outlook, Gmail or any email app. Only emails forwarded by people on your team are accepted.
              Add a note above the forwarded message if there&apos;s anything quoteout should know.
            </p>
          </>
        ) : (
          <p className="sub" style={{ marginTop: 0 }}>Your forwarding address is being set up. Until then, drag the email in below.</p>
        )}
      </section>

      <section className="card" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <h2 style={{ margin: 0 }}>Or add it here</h2>
        <NewQuoteForm tenantId={ctx.tenant.id} canSend={ctx.role !== "viewer"} />
      </section>
    </div>
  );
}
