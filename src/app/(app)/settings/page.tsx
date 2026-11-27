import { requireTenant } from "@/lib/tenant";
import { createClient } from "@/lib/supabase/server";
import { SettingsForm, type Settings } from "./form";

const DEFAULTS: Settings = {
  margin_mode: "none",
  margin_per_shift: null,
  margin_percent: null,
  whole_dollar_rates: false,
  default_binder: null,
  default_prime: null,
  spray_markup_percent: null,
  extra_establishment_rate: null,
  change_tolerance_percent: 5,
  reuse_quote_numbers: false,
  pass_on_rules: null,
  info_request_signature: null,
};

export default async function SettingsPage() {
  const ctx = await requireTenant();
  const supabase = await createClient();
  const { data } = await supabase
    .from("tenant_settings")
    .select(
      "margin_mode, margin_per_shift, margin_percent, whole_dollar_rates, default_binder, default_prime, spray_markup_percent, extra_establishment_rate, change_tolerance_percent, reuse_quote_numbers, pass_on_rules, info_request_signature",
    )
    .eq("tenant_id", ctx.tenant.id)
    .maybeSingle();

  const initial: Settings = { ...DEFAULTS, ...(data ?? {}) } as Settings;

  return (
    <div className="page" style={{ maxWidth: 860 }}>
      <div>
        <h1>Settings</h1>
        <p className="sub">
          Your company&apos;s figures and defaults. The rules on the Teach screen use these, so Quotr drafts the way you price.
        </p>
      </div>
      <SettingsForm initial={initial} canEdit={ctx.role === "admin"} />
    </div>
  );
}
