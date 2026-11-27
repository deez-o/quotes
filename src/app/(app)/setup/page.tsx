import Link from "next/link";
import { requireTenant } from "@/lib/tenant";
import { createClient } from "@/lib/supabase/server";

type Step = { title: string; detail: string; done: boolean; action?: { label: string; href?: string; external?: boolean } };

const STORAGE_LABEL: Record<string, string> = {
  app: "Files kept in quoteout",
  onedrive: "Files kept in quoteout, copied to OneDrive",
  sharepoint: "Files kept in quoteout, copied to SharePoint",
  google_drive: "Files kept in quoteout, copied to Google Drive",
};

export default async function SetupPage({ searchParams }: { searchParams: Promise<{ error?: string; connected?: string }> }) {
  const { error: setupError, connected } = await searchParams;
  const ctx = await requireTenant();
  const supabase = await createClient();
  const t = ctx.tenant.id;

  const count = async (table: string, filter?: (q: any) => any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
    let q = supabase.from(table).select("id", { count: "exact", head: true }).eq("tenant_id", t);
    if (filter) q = filter(q);
    const { count } = await q;
    return count ?? 0;
  };

  const settingsPromise = supabase
    .from("tenant_settings")
    .select("default_binder, spray_markup_percent")
    .eq("tenant_id", t)
    .maybeSingle();

  const [mailboxes, workbooks, products, rates, activeRules, proposedRules, examples] = await Promise.all([
    count("connections", (q) => q.eq("purpose", "mailbox").eq("status", "ok")),
    count("workbook_templates"),
    count("catalogue_products"),
    count("rates"),
    count("rules", (q) => q.eq("status", "active")),
    count("rules", (q) => q.eq("status", "proposed")),
    count("examples"),
  ]);

  const { data: settings } = await settingsPromise;
  const settingsDone = Boolean(settings?.default_binder && settings?.spray_markup_percent != null);

  const steps: Step[] = [
    {
      title: "Connect your email",
      detail: mailboxes ? "Inbox connected" : "Microsoft 365 first; Gmail and email forwarding to follow",
      done: mailboxes > 0,
      action: mailboxes ? undefined : { label: "Connect Microsoft 365", href: "/api/connect/microsoft", external: true },
    },
    {
      title: "Choose where files live",
      detail: STORAGE_LABEL[ctx.tenant.file_storage] ?? "Files kept in quoteout",
      done: true,
    },
    {
      title: "Upload your pricing workbook",
      detail: workbooks ? `${workbooks} workbook uploaded` : "Your own .xlsm or .xlsx; macros are kept",
      done: workbooks > 0,
      action: workbooks ? undefined : { label: "Coming in milestone M3" },
    },
    {
      title: "Load your products and rates",
      detail: `${products} products · ${rates} rates`,
      done: products > 0 && rates > 0,
    },
    {
      title: "Set your pricing defaults",
      detail: settingsDone ? "Defaults saved" : "Margin target, default binder and prime, spray mark-up, extra establishments",
      done: settingsDone,
      action: { label: settingsDone ? "Edit" : "Open settings", href: "/settings" },
    },
    {
      title: "Tell quoteout how you quote",
      detail: `${activeRules} rules active${proposedRules ? ` · ${proposedRules} waiting for your OK` : ""}`,
      done: activeRules > 0 && proposedRules === 0,
      action: { label: "Review rules", href: "/teach" },
    },
    {
      title: "Add 3 to 5 past quotes",
      detail: `${examples} of 3 added. quoteout copies your style from these.`,
      done: examples >= 3,
    },
    {
      title: "Test on your last 10 RFQs",
      detail: "A dry run: you see the drafts, nothing is labelled or sent.",
      done: false,
      action: { label: "Coming in milestone M3" },
    },
  ];

  const doneCount = steps.filter((s) => s.done).length;
  const nextIndex = steps.findIndex((s) => !s.done);

  return (
    <div className="page">
      <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-end" }}>
        <div>
          <h1>Set up quoteout</h1>
          <p className="sub">Nothing is sent or labelled until you press Go live.</p>
        </div>
        <strong>{doneCount} of {steps.length} done</strong>
      </div>
      <div style={{ height: 8, background: "var(--line)", borderRadius: 4 }}>
        <div style={{ width: `${(doneCount / steps.length) * 100}%`, height: 8, background: "var(--accent)", borderRadius: 4 }} />
      </div>

      {setupError && <p className="error" role="alert">{setupError}</p>}
      {connected && <p style={{ color: "var(--good)", fontWeight: 600 }}>Connected {connected}. New emails will now be picked up.</p>}

      <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 12 }}>
        {steps.map((s, i) => (
          <li key={s.title} className={`card row${i === nextIndex ? " focus" : ""}`} style={{ padding: "16px 20px" }}>
            <span
              aria-hidden="true"
              style={{
                width: 32, height: 32, borderRadius: 16, flex: "none", display: "grid", placeItems: "center", fontWeight: 600,
                background: s.done ? "var(--good-bg)" : i === nextIndex ? "var(--accent)" : "transparent",
                color: s.done ? "var(--good)" : i === nextIndex ? "#fff" : "var(--muted)",
                border: s.done || i === nextIndex ? "none" : "1px solid #b5b2ab",
              }}
            >
              {s.done ? "✓" : i + 1}
            </span>
            <div className="grow">
              <div style={{ fontWeight: 600 }}>{s.title}</div>
              <div className="sub" style={{ marginTop: 0 }}>{s.detail}</div>
            </div>
            {s.done ? (
              <span className="badge good">Done</span>
            ) : s.action?.href && s.action.external ? (
              <a className="btn primary" href={s.action.href}>{s.action.label}</a>
            ) : s.action?.href ? (
              <Link className="btn primary" href={s.action.href}>{s.action.label}</Link>
            ) : s.action ? (
              <span className="badge quiet">{s.action.label}</span>
            ) : null}
          </li>
        ))}
      </ol>
    </div>
  );
}
