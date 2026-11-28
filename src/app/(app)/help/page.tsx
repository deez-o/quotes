import { requireTenant } from "@/lib/tenant";
import { createAdminClient } from "@/lib/supabase/admin";
import { CloseForm, HelpForm } from "./forms";
import { undoClose } from "./actions";

const FAQ: [string, string][] = [
  ["How do I quote an RFQ?", "Forward the RFQ email (attachments and all) to your quoteout address, shown under New Quote → Import an RFQ. You can also drag the email in or paste it there. quoteout reads it and drafts the quote, usually in a minute or two. It shows in Quotes as ready to check."],
  ["How do I quote on site?", "New Quote → Quick quote. Say or type what the job is, add photos, and it's priced from your costs straight away. Open Measure on the map to trace areas on the satellite view."],
  ["Where do my prices come from?", "Your costs library (Setup → Costs): your materials, crew, plant and trucks. quoteout does the maths; the AI only reads what the job is. Change a rate and new quotes use it."],
  ["How does the customer accept?", "Use Send to customer on the quote. They get the PDF and a View and accept quote button. When they accept, the quote is marked won and you get an email with their name and PO number."],
  ["How do I give the customer options?", "On the quote, use + Add an option. Change what's different (mix, depth, area) and it prices on its own. They all go on one PDF and the customer picks one."],
  ["The customer wants changes after I sent it", "Use Make a revision. The version they have is kept as it was, and you change the new one (Rev B). Their old accept link tells them to use the newest one."],
  ["How do I stop people sharing logins?", "Each plan allows a set number of devices per person. Signing in on another one signs out the oldest. A client admin can add people under Setup."],
];

/** Help: common questions, a way to reach quoteout, and the company's data. */
export default async function HelpPage() {
  const ctx = await requireTenant();
  const admin = createAdminClient();
  const { data: t } = await admin.from("tenants").select("close_requested_at").eq("id", ctx.tenant.id).single();
  const isAdmin = ctx.role === "admin";
  return (
    <div className="page" style={{ maxWidth: 860 }}>
      <div><h1>Help</h1><p className="sub">Answers to common questions, and a way to reach us.</p></div>

      <section className="card" style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <h2 style={{ marginTop: 0 }}>Common questions</h2>
        {FAQ.map(([q, a]) => (
          <details key={q} style={{ borderTop: "1px solid var(--line-soft)", padding: "10px 0" }}>
            <summary style={{ cursor: "pointer", fontWeight: 600 }}>{q}</summary>
            <p style={{ margin: "6px 0 0" }}>{a}</p>
          </details>
        ))}
      </section>

      <section className="card">
        <h2 style={{ marginTop: 0 }}>Ask us</h2>
        <p className="sub" style={{ marginTop: 0 }}>Questions, problems or ideas. We reply by email to {ctx.email ?? "you"}.</p>
        <HelpForm />
      </section>

      {isAdmin && (
        <section className="card" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <h2 style={{ margin: 0 }}>Your company&apos;s data</h2>
          <p style={{ margin: 0 }}>Your quotes, customers and costs are yours. Download a copy any time: a zip with spreadsheets (CSV) and the latest quote PDFs.</p>
          <div><a className="btn" href="/api/account/export" download>Download all our data</a></div>
          <details style={{ marginTop: 6 }}>
            <summary style={{ cursor: "pointer", fontWeight: 600 }}>Close our account</summary>
            <div style={{ marginTop: 10 }}>
              {t?.close_requested_at ? (
                <form action={undoClose} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <p style={{ margin: 0 }}>You asked to close this account on {new Date(t.close_requested_at).toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric" })}. Billing stops at the end of your paid period, and your data is deleted 30 days after that.</p>
                  <div><button type="submit" className="btn">Keep our account open</button></div>
                </form>
              ) : (
                <>
                  <p style={{ marginTop: 0 }}>Billing stops at the end of the period you&apos;ve paid for, and you can keep using quoteout until then. Your data is deleted 30 days after that. Download it first if you want a copy.</p>
                  <CloseForm company={ctx.tenant.name} />
                </>
              )}
            </div>
          </details>
        </section>
      )}
    </div>
  );
}
