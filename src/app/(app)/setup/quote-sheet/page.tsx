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
          Every quote has an Excel button. By default it downloads the quoteout workings: every cost (tonnes, cartage, crew hours and
          overtime, plant, margin) as live formulas, so you can check or tweak the numbers, with the customer quote on a second tab.
          If you&apos;d rather have your own quote sheet, upload it: quoteout works out where everything goes, shows it filled with a sample,
          and once you say it&apos;s right, quotes download in your sheet with its formatting and macros kept.
        </p>
      </div>
      {ctx.role !== "admin"
        ? <p className="card">Only your company&apos;s admin can set this up.</p>
        : <QuoteSheetSetup tenantId={ctx.tenant.id} initial={r.ok ? r.preview : null} loadError={r.ok ? null : r.message} />}
    </div>
  );
}
