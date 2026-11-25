/**
 * Every AI call goes through one function, so the provider can be swapped
 * per tenant and tested on the same fixtures.
 */
import { RFQ_QUOTE_ANSWER_SCHEMA, type QuoteAnswer } from "./schema";

export type Usage = { input_tokens: number; cached_tokens: number; output_tokens: number };

export type ProviderResult = {
  provider: string;
  model: string;
  json: unknown;
  usage: Usage;
  latency_ms: number;
};

export interface QuoteProvider {
  readonly name: string;
  readonly model: string;
  draft(system: string, user: string, retryNote?: string): Promise<ProviderResult>;
}

/** Prices per million tokens (USD). From the build brief, checked 25 Nov 2026: re-check before setting customer prices. */
export const PRICES: Record<string, { input: number; cached: number; output: number }> = {
  "grok-4.3": { input: 1.25, cached: 0.2, output: 2.5 },
  "grok-4.7": { input: 2.0, cached: 0.5, output: 6.0 },
};

export function costUsd(model: string, usage: Usage): number | null {
  const p = PRICES[model];
  if (!p) return null;
  const fresh = Math.max(0, usage.input_tokens - usage.cached_tokens);
  return (fresh * p.input + usage.cached_tokens * p.cached + usage.output_tokens * p.output) / 1_000_000;
}

type ChatResponse = {
  choices?: { message?: { content?: string } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } };
  error?: { message?: string };
};

/** xAI Grok via its OpenAI-compatible chat completions API with structured outputs. */
export class XaiProvider implements QuoteProvider {
  readonly name = "xai";
  constructor(
    private readonly apiKey: string,
    readonly model = "grok-4.3",
    private readonly baseUrl = "https://api.x.ai/v1",
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async draft(system: string, user: string, retryNote?: string): Promise<ProviderResult> {
    const messages = [
      { role: "system", content: system },
      { role: "user", content: user },
      ...(retryNote ? [{ role: "user", content: `Your previous answer had these problems. Return a corrected full answer:\n${retryNote}` }] : []),
    ];
    const started = Date.now();
    const res = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({
        model: this.model,
        messages,
        response_format: { type: "json_schema", json_schema: RFQ_QUOTE_ANSWER_SCHEMA },
        temperature: 0,
      }),
    });
    const data = (await res.json()) as ChatResponse;
    if (!res.ok) throw new Error(`xAI ${res.status}: ${data.error?.message ?? "request failed"}`);

    const content = data.choices?.[0]?.message?.content ?? "";
    let json: unknown;
    try {
      json = JSON.parse(content);
    } catch {
      throw new Error("xAI returned text that is not JSON.");
    }
    return {
      provider: this.name,
      model: this.model,
      json,
      usage: {
        input_tokens: data.usage?.prompt_tokens ?? 0,
        cached_tokens: data.usage?.prompt_tokens_details?.cached_tokens ?? 0,
        output_tokens: data.usage?.completion_tokens ?? 0,
      },
      latency_ms: Date.now() - started,
    };
  }
}

/** Light shape check before the business checks (strict schema should already guarantee this). */
export function looksLikeAnswer(json: unknown): json is QuoteAnswer {
  if (!json || typeof json !== "object") return false;
  const o = json as Record<string, unknown>;
  return o.schema_version === "1.0" && Array.isArray(o.scope) && Array.isArray(o.flags) && typeof o.classification === "object";
}
