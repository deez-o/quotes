import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { costUsd, type ProviderResult } from "@/lib/quote/provider";
import { periodNow } from "@/lib/plans";

export type AiKind = "ai_quote" | "ai_change" | "ai_price_list" | "ai_rfq";

/** Counts one AI call against the company (and the person), with its cost. Never fails the caller. */
export async function recordAi(tenantId: string, userId: string | null, kind: AiKind, result: Pick<ProviderResult, "model" | "usage">) {
  try {
    await createAdminClient().from("usage_events").insert({
      tenant_id: tenantId, user_id: userId, module: "quoting", kind, qty: 1,
      cost_usd: costUsd(result.model, result.usage), period: periodNow(),
    });
  } catch {
    // Usage logging must never stop a quote.
  }
}

/** Wraps an AI call so every use is logged. */
export function counted<A extends unknown[]>(fn: (...a: A) => Promise<ProviderResult>, tenantId: string, userId: string | null, kind: AiKind) {
  return async (...a: A) => {
    const r = await fn(...a);
    await recordAi(tenantId, userId, kind, r);
    return r;
  };
}
