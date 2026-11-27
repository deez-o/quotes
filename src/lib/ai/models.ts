/** The AI models quoteout can use. Prices are in lib/quote/provider.ts. */
export type AiProviderId = "xai" | "anthropic";

export type AiModel = { id: string; provider: AiProviderId; label: string; note: string };

export const AI_MODELS: AiModel[] = [
  { id: "grok-4.3", provider: "xai", label: "Grok 4.3", note: "Cheapest Grok. What quoteout has used so far." },
  { id: "grok-4.6", provider: "xai", label: "Grok 4.6", note: "xAI's previous flagship, same price as 4.7." },
  { id: "grok-4.7", provider: "xai", label: "Grok 4.7", note: "xAI's latest flagship." },
  { id: "claude-haiku-5-5", provider: "anthropic", label: "Claude Haiku 5.5", note: "Fastest and cheapest Claude." },
  { id: "claude-sonnet-5-5", provider: "anthropic", label: "Claude Sonnet 5.5", note: "Claude's balance of speed and smarts. Reads scanned PDFs." },
  { id: "claude-opus-5-5", provider: "anthropic", label: "Claude Opus 5.5", note: "Claude's most capable everyday model. Slower, dearer." },
];

export const DEFAULT_MODEL = "grok-4.3";

export function modelInfo(id: string | null | undefined): AiModel | null {
  return AI_MODELS.find((m) => m.id === id) ?? null;
}

export function providerOf(id: string): AiProviderId {
  return modelInfo(id)?.provider ?? (id.startsWith("claude") ? "anthropic" : "xai");
}
