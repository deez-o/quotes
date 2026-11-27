import Link from "next/link";
import { requireTenant } from "@/lib/tenant";

const OPTIONS = [
  { href: "/site/new", title: "Quick quote", detail: "Describe the job by voice or keyboard and add photos. Priced from your costs straight away.", cta: "Start quote" },
  { href: "/new?mode=files", title: "Import an RFQ", detail: "Upload the RFQ email, PDFs and drawings. quoteout reads the pack and drafts the quote.", cta: "Upload files" },
  { href: "/new?mode=paste", title: "Paste an email", detail: "Paste the RFQ email text, and add any attachments. quoteout drafts the quote from it.", cta: "Paste email" },
] as const;

/** New Quote: pick how the job comes in. */
export default async function NewQuotePage() {
  const ctx = await requireTenant();
  return (
    <div className="page" style={{ maxWidth: 980 }}>
      <div>
        <h1>New Quote</h1>
        <p className="sub">How is this job coming in? RFQs that arrive in your connected inbox, or that you forward to quoteout, show up in Quotes on their own.</p>
      </div>
      {ctx.role === "viewer" ? (
        <p className="sub">Viewers can&apos;t create quotes.</p>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 16 }}>
          {OPTIONS.map((o, i) => (
            <Link key={o.href} href={o.href} className={`card${i === 0 ? " focus" : ""}`} style={{ display: "flex", flexDirection: "column", gap: 10, minHeight: 190 }}>
              <h2 style={{ margin: 0, fontSize: 18 }}>{o.title}</h2>
              <p className="sub" style={{ marginTop: 0, flex: 1 }}>{o.detail}</p>
              <span className={`btn${i === 0 ? " primary" : ""}`} style={{ alignSelf: "flex-start" }}>{o.cta}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
