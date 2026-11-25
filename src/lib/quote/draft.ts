/**
 * draftQuote: one AI call, validate, at most one targeted retry, then the
 * code-side finishing. Returns everything the worker needs to store and file.
 */
import { buildSystemPrompt, buildUserMessage, PROMPT_VERSION, type RfqBundle, type SystemPromptInput } from "./prompt";
import { costUsd, looksLikeAnswer, type ProviderResult, type QuoteProvider } from "./provider";
import { finishAnswer, validateAnswer, type Finished, type TenantQuoteContext } from "./validate";

export type DraftOutcome =
  | { status: "drafted"; finished: Finished; runs: RunRecord[]; warnings: string[] }
  | { status: "needs_attention"; reason: string; lastErrors: string[]; runs: RunRecord[] };

export type RunRecord = {
  provider: string;
  model: string;
  prompt_version: string;
  input_tokens: number;
  cached_tokens: number;
  output_tokens: number;
  cost_usd: number | null;
  latency_ms: number;
  valid: boolean;
  error: string | null;
  raw_json: unknown;
};

const MAX_ATTEMPTS = 2;

function record(r: ProviderResult, valid: boolean, error: string | null): RunRecord {
  return {
    provider: r.provider,
    model: r.model,
    prompt_version: PROMPT_VERSION,
    ...r.usage,
    cost_usd: costUsd(r.model, r.usage),
    latency_ms: r.latency_ms,
    valid,
    error,
    raw_json: r.json,
  };
}

export async function draftQuote(
  provider: QuoteProvider,
  promptInput: SystemPromptInput,
  bundle: RfqBundle,
  ctx: TenantQuoteContext,
): Promise<DraftOutcome> {
  const system = buildSystemPrompt(promptInput);
  const user = buildUserMessage(bundle);
  const runs: RunRecord[] = [];
  let retryNote: string | undefined;
  let lastErrors: string[] = [];

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let result: ProviderResult;
    try {
      result = await provider.draft(system, user, retryNote);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      runs.push({
        provider: provider.name, model: provider.model, prompt_version: PROMPT_VERSION,
        input_tokens: 0, cached_tokens: 0, output_tokens: 0, cost_usd: 0, latency_ms: 0,
        valid: false, error: msg, raw_json: null,
      });
      return { status: "needs_attention", reason: `AI call failed: ${msg}`, lastErrors: [msg], runs };
    }

    if (!looksLikeAnswer(result.json)) {
      lastErrors = ["Answer did not match schema rfq_quote_answer v1.0."];
      runs.push(record(result, false, lastErrors[0]));
      retryNote = lastErrors.join("\n");
      continue;
    }

    const { errors, warnings } = validateAnswer(result.json, ctx);
    if (errors.length === 0) {
      runs.push(record(result, true, null));
      return { status: "drafted", finished: finishAnswer(result.json, ctx), runs, warnings };
    }
    lastErrors = errors;
    runs.push(record(result, false, errors.join(" | ")));
    retryNote = errors.map((e) => `- ${e}`).join("\n");
  }

  return { status: "needs_attention", reason: "The draft still failed checks after a retry.", lastErrors, runs };
}
