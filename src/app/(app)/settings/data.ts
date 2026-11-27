import { createClient } from "@/lib/supabase/server";
import type { Settings } from "./form";

const DEFAULTS: Settings = {
  margin_mode: "none",
  margin_per_shift: null,
  margin_percent: null,
  whole_dollar_rates: false,
  default_binder: "C320",
  default_prime: "K2",
  spray_markup_percent: 15,
  extra_establishment_rate: 5000,
  change_tolerance_percent: 5,
  reuse_quote_numbers: false,
  pass_on_rules: null,
  info_request_signature: null,
};

/** The company's pricing target and defaults, for the Setup page. */
export async function loadSettings(tenantId: string): Promise<Settings> {
  const supabase = await createClient();

  const { data } = await supabase
    .from("tenant_settings")
    .select(
      "margin_mode, margin_per_shift, margin_percent, whole_dollar_rates, default_binder, default_prime, spray_markup_percent, extra_establishment_rate, change_tolerance_percent, reuse_quote_numbers, pass_on_rules, info_request_signature",
    )
    .eq("tenant_id", tenantId)
    .maybeSingle();

  return { ...DEFAULTS, ...(data ?? {}) } as Settings;

}
