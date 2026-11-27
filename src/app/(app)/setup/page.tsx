import Link from "next/link";
import { SettingsForm } from "../settings/form";
import { BrandingForm, type Branding } from "./branding-form";
import { loadSettings } from "../settings/data";
import { requireTenant } from "@/lib/tenant";
import { createClient } from "@/lib/supabase/server";
import { loadAccess } from "@/lib/access-load";
import { loadSheet } from "@/lib/sheet/store";
import { planFor } from "@/lib/plans";

type Step = { title: string; detail: string; done: boolean; optional?: boolean; action?: { label: string; href?: string; external?: boolean } };

const STORAGE_LABEL: Record<string, string> = {
  app: "Files kept in quoteout",
  onedrive: "Files kept in quoteout, copied to OneDrive",
  sharepoint: "Files kept in quoteout, copied to SharePoint",
  google_drive: "Files kept in quoteout, copied to Google Drive",
};

export default async function SetupPage({ searchParams }: { searchParams: Promise<{ error?: string; connected?: string }> }) {
  const { error: setupError, connected } = await searchParams;
  const ctx = await requireTenant();
  const { tenant: billing } = await loadAccess(ctx.tenant.id);
  const plan = planFor(billing.plan);
  const pricing = await loadSettings(ctx.tenant.id);
  const supa = await createClient();
  const { data: b } = await supa.from("tenant_settings")
    .select("logo_path, brand_color, business_name, business_abn, business_phone, business_email, business_address, business_website")
    .eq("tenant_id", ctx.tenant.id).maybeSingle();
  const logoUrl = b?.logo_path ? (await supa.storage.from("job-files").createSignedUrl(b.logo_path, 3600)).data?.signedUrl ?? null : null;
  const branding: Branding = {
    logo_path: b?.logo_path ?? null, logo_url: logoUrl, brand_color: b?.brand_color ?? null,
    business_name: b?.business_name ?? null, business_abn: b?.business_abn ?? null, business_phone: b?.business_phone ?? null,
    business_email: b?.business_email ?? null, business_address: b?.business_address ?? null, business_website: b?.business_website ?? null,
  };
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

  const [mailboxes, , costItems, plants, activeRules, proposedRules, examples, xero] = await Promise.all([
    count("connections", (q) => q.eq("purpose", "mailbox").eq("status", "ok")),
    count("workbook_templates"),
    count("cost_items", (q) => q.eq("active", true)),
    count("supply_plants", (q) => q.eq("active", true)),
    count("rules", (q) => q.eq("status", "active")),
    count("rules", (q) => q.eq("status", "proposed")),
    count("examples"),
    count("connections", (q) => q.eq("provider", "xero").eq("status", "ok")),
  ]);

  const { data: settings } = await settingsPromise;
  const quoteSheet = await loadSheet(supabase, t);
  const { data: inbound } = await supabase.from("inbound_addresses").select("local_part").eq("tenant_id", t).limit(1).maybeSingle();
  const inboundAddress = inbound?.local_part ? `${inbound.local_part}@${process.env.INBOUND_DOMAIN ?? "in.quoteout.app"}` : null;
  const settingsDone = Boolean(settings?.default_binder && settings?.spray_markup_percent != null);

  const steps: Step[] = [
    {
      title: "Put in your costs",
      detail: `${costItems} costs · ${plants} supply plant${plants === 1 ? "" : "s"}. Crew, materials, plant hire, trucks, float, and each plant's mix prices.`,
      done: costItems > 0 && plants > 0,
      action: { label: costItems ? "Edit costs" : "Add costs", href: "/costs" },
    },
    {
      title: "Set your pricing target and defaults",
      detail: settingsDone ? "Saved" : "Margin target, default binder and prime, spray mark-up, extra establishments",
      done: settingsDone,
      action: { label: settingsDone ? "Edit" : "Set it below", href: "#pricing" },
    },
    {
      title: "Add your branding",
      detail: branding.logo_path ? "Logo and colour on your quotes" : "Your logo, colour and business details on printed quotes and PDFs",
      done: !!branding.logo_path,
      optional: true,
      action: { label: branding.logo_path ? "Edit" : "Add it below", href: "#branding" },
    },
    {
      title: "Connect Xero",
      detail: xero ? "Connected. Quotes go to Xero as drafts with Send to Xero." : "Send quotes to Xero as drafts, ready to check and send from there. Or use PDF.",
      done: xero > 0,
      optional: true,
      action: { label: xero ? "Reconnect" : "Connect Xero", href: "/api/connect/xero", external: true },
    },
    {
      title: "Forward RFQs by email",
      detail: plan.emailAutoQuote
        ? (inboundAddress ? `Forward RFQs to ${inboundAddress} from your team's email. They show up in Quotes, ready to check.` : "Your forwarding address is being set up.")
        : "Forward RFQs from your inbox and quoteout drafts the quote. Included in Pro and Business.",
      done: plan.emailAutoQuote && mailboxes > 0,
      optional: true,
      action: plan.emailAutoQuote ? undefined : { label: "See plans", href: "/billing" },
    },
    {
      title: "Choose where files live",
      detail: STORAGE_LABEL[ctx.tenant.file_storage] ?? "Files kept in quoteout",
      done: true,
    },
    {
      optional: true,
      title: "Your quote spreadsheet (optional)",
      detail: quoteSheet?.confirmed_at ? `Quotes download in ${quoteSheet.filename}` : quoteSheet ? `${quoteSheet.filename}: check where things go` : "Quotes download in quoteout's standard Excel sheet, in your branding. Upload your own sheet to use that instead; formatting and macros are kept.",
      done: Boolean(quoteSheet?.confirmed_at),
      action: { label: quoteSheet ? "Check or change" : "Use your own sheet", href: "/setup/quote-sheet" },
    },
    {
      optional: true,
      title: "Add 3 to 5 past quotes (optional)",
      detail: `${examples} of 3 added. quoteout copies your style from these.`,
      done: examples >= 3,
    },
    {
      optional: true,
      title: "Your quoting rules",
      detail: activeRules ? `${activeRules} of your own rules in use${proposedRules ? ` · ${proposedRules} suggested` : ""}` : "Optional. quoteout already knows how to quote; add how you do things differently.",
      done: activeRules > 0,
      action: { label: activeRules ? "Edit rules" : "Add a rule", href: "/teach" },
    },
  ];

  const required = steps.filter((s) => !s.optional);
  const doneCount = required.filter((s) => s.done).length;
  const nextIndex = steps.findIndex((s) => !s.done && !s.optional);

  return (
    <div className="page">
      <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-end" }}>
        <div>
          <h1>Set up quoteout</h1>
          <p className="sub">Nothing is sent or labelled until you press Go live.</p>
        </div>
        <strong>{doneCount} of {required.length} done</strong>
      </div>
      <div style={{ height: 8, background: "var(--line)", borderRadius: 4 }}>
        <div style={{ width: `${(doneCount / required.length) * 100}%`, height: 8, background: "var(--accent)", borderRadius: 4 }} />
      </div>

      <SettingsForm initial={pricing} canEdit={ctx.role === "admin"} />

      <BrandingForm tenantId={ctx.tenant.id} initial={branding} fallbackName={ctx.tenant.name} canEdit={ctx.role === "admin"} />

      {setupError && <p className="error" role="alert">{setupError}</p>}
      {connected && <p style={{ color: "var(--good)", fontWeight: 600 }}>Connected {connected}. New emails will now be picked up.</p>}

      <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 12 }}>
        {steps.map((s, i) => (
          <li key={s.title} id={s.title === "Connect Xero" ? "xero" : undefined} className={`card row${i === nextIndex ? " focus" : ""}`} style={{ padding: "16px 20px" }}>
            <span
              aria-hidden="true"
              style={{
                width: 32, height: 32, borderRadius: 16, flex: "none", display: "grid", placeItems: "center", fontWeight: 600,
                background: s.done ? "var(--good-bg)" : i === nextIndex ? "var(--accent)" : "transparent",
                color: s.done ? "var(--good)" : i === nextIndex ? "#fff" : "var(--muted)",
                border: s.done || i === nextIndex ? "none" : "1px solid #b6bcc4",
              }}
            >
              {s.done ? "✓" : i + 1}
            </span>
            <div className="grow">
              <div style={{ fontWeight: 600 }}>{s.title}</div>
              <div className="sub" style={{ marginTop: 0 }}>{s.detail}</div>
            </div>
            {s.done ? (
              <span className="row" style={{ gap: 8 }}>
                <span className="badge good">Done</span>
                {s.action?.href && (s.action.external ? <a className="btn" href={s.action.href}>{s.action.label}</a> : <Link className="btn" href={s.action.href}>{s.action.label}</Link>)}
              </span>
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
