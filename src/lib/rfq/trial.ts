import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { structuredCall } from "@/lib/ai/call";
import { providerOf } from "@/lib/ai/models";
import { costUsd, type ChatMessage } from "@/lib/quote/provider";
import { loadPricingContext } from "@/lib/site/load";
import { loadLayeredRules } from "@/lib/rules-load";
import { SITE_SCOPE_SCHEMA, scopeFromRfq } from "@/lib/site/scope-ai";
import type { SiteScope } from "@/lib/site/price";
import { gatherRfq, locateAndPrice } from "./draft";

export type TrialResult = { model: string; scope: SiteScope | null; total: number | null; questions: number; costUsd: number | null; latencyMs: number; error: string | null };

/**
 * Runs one RFQ through several models side by side, priced with the company's own costs.
 * Saves nothing to the company's quotes and doesn't count against their allowance.
 */
export async function runTrials(db: SupabaseClient, tenantId: string, jobId: string, models: string[]): Promise<TrialResult[]> {
  const { data: job } = await db.from("jobs").select("id, site").eq("tenant_id", tenantId).eq("id", jobId).single();
  const { data: messages } = await db.from("messages").select("from_address, subject, received_at").eq("tenant_id", tenantId).eq("job_id", jobId).order("received_at", { ascending: true });
  const [g, pc, rules, { data: tenant }] = await Promise.all([
    gatherRfq(db, tenantId, jobId, job?.site ?? null, messages ?? []),
    loadPricingContext(db, tenantId),
    loadLayeredRules(db, tenantId),
    db.from("tenants").select("name").eq("id", tenantId).single(),
  ]);

  return Promise.all(models.map(async (model): Promise<TrialResult> => {
    const started = Date.now();
    try {
      let usage = { input_tokens: 0, cached_tokens: 0, output_tokens: 0 };
      const call = async (messages: ChatMessage[]) => {
        const r = await structuredCall(model, SITE_SCOPE_SCHEMA, messages);
        usage = r.usage;
        return r;
      };
      const out = await scopeFromRfq(call, { tradingName: tenant?.name ?? "the contractor", library: pc.library, plants: pc.plants, rules }, {
        from: g.summary.from, subject: g.summary.subject, received: g.summary.received, body: g.rfq.body, attachments: g.attachments,
        extraNotes: g.emails.slice(1).map((e) => `--- Later email from ${e.from ?? "?"} (${e.date ?? "?"}) ---\n${e.body.slice(0, 8000)}`),
      });
      let scope: SiteScope = { ...out.scope, haul_override: null, supply_plant_auto: false };
      const readsPdfs = providerOf(model) === "anthropic";
      for (const f of g.summaryFiles.filter((x) => x.read === "no" && !(readsPdfs && x.note?.startsWith("scanned PDF")))) {
        scope.questions.push(`"${f.name}" couldn't be read (${f.note ?? "unknown"}).`);
      }
      const placed = await locateAndPrice(pc, scope);
      scope = placed.scope;
      return { model, scope, total: placed.priced.priceExGst, questions: scope.questions.length, costUsd: costUsd(model, usage), latencyMs: Date.now() - started, error: null };
    } catch (e) {
      return { model, scope: null, total: null, questions: 0, costUsd: null, latencyMs: Date.now() - started, error: e instanceof Error ? e.message : "failed" };
    }
  }));
}
