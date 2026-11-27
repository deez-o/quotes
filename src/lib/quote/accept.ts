import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { QUOTE_COLUMNS, type LoadedQuote } from "./pdf-load";

/** Tokens are 32 url-safe characters. */
export const TOKEN = /^[A-Za-z0-9_-]{32}$/;

/** The quote a customer's accept link points to, with its options. */
export async function findByToken(admin: SupabaseClient, token: string) {
  if (!TOKEN.test(token)) return null;
  const { data } = await admin.from("site_quotes").select(`${QUOTE_COLUMNS}, tenant_id`).eq("accept_token", token).maybeSingle();
  if (!data) return null;
  const lead = data as unknown as LoadedQuote & { tenant_id: string };
  let group: LoadedQuote[] = [lead];
  if (lead.option_group) {
    const { data: all } = await admin.from("site_quotes").select(QUOTE_COLUMNS).eq("tenant_id", lead.tenant_id).eq("option_group", lead.option_group).eq("revision", lead.revision).order("option_label");
    if (all?.length) group = all as unknown as LoadedQuote[];
  }
  const accepted = group.find((g) => g.accepted_at) ?? null;
  return { tenantId: lead.tenant_id, lead, group, accepted, superseded: Boolean(lead.superseded_at) };
}
