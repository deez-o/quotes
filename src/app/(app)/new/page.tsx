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
    <div className="page" style={{ maxWidth: 860 }}>
      <div>
        <h1>New quote</h1>
        <p className="sub">Send quoteout a request for quote. It files the job, reads everything and drafts the quote for you to check.</p>
      </div>

      <NewQuoteForm tenantId={ctx.tenant.id} canSend={ctx.role !== "viewer"} />

      <section className="card" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <h2 style={{ margin: 0 }}>Or forward it from your email</h2>
        {forwardTo ? (
          <>
            <p>
              Forward the RFQ, attachments and all, to <strong style={{ userSelect: "all" }}>{forwardTo}</strong>
            </p>
            <p className="sub" style={{ marginTop: 0 }}>
              Works from Outlook, Gmail or any email app. Only emails forwarded by people on your team are accepted.
              Add a note above the forwarded message if there&apos;s anything quoteout should know.
            </p>
          </>
        ) : (
          <p className="sub" style={{ marginTop: 0 }}>Your forwarding address is being set up. Until then, drag the email in above.</p>
        )}
      </section>
    </div>
  );
}
