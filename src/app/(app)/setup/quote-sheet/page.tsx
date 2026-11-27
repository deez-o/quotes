import Link from "next/link";
import { requireTenant } from "@/lib/tenant";
import { currentPreview } from "./actions";
import { QuoteSheetSetup } from "./setup";

export default async function QuoteSheetPage() {
  const ctx = await requireTenant();
  const r = ctx.role === "admin" ? await currentPreview() : { ok: true as const, preview: null };
  return (
    <div className="page">
      <div>
        <Link href="/setup" className="sub" style={{ marginTop: 0 }}>← Setup</Link>
        <h1 style={{ marginTop: 6 }}>Your quote spreadsheet</h1>
        <p className="sub">
          Upload the Excel sheet you quote on now. quoteout works out where everything goes, shows you it filled with a sample quote,
          and once you say it&apos;s right, every quote can be downloaded in your sheet. Your formatting, logo, formulas and macros stay as they are.
        </p>
      </div>
      {ctx.role !== "admin"
        ? <p className="card">Only your company&apos;s admin can set this up.</p>
        : <QuoteSheetSetup tenantId={ctx.tenant.id} initial={r.ok ? r.preview : null} loadError={r.ok ? null : r.message} />}
    </div>
  );
}
