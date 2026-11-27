import "server-only";
import { cache } from "react";
import { createAdminClient } from "@/lib/supabase/admin";
import { anthropicStructured, xaiStructured, type ChatMessage, type ProviderResult } from "@/lib/quote/provider";
import { counted, type AiKind } from "@/lib/usage";
import { DEFAULT_MODEL, modelInfo, providerOf } from "./models";

type Schema = { name: string; strict: boolean; schema: object };

export function keyFor(model: string): string | null {
  return (providerOf(model) === "anthropic" ? process.env.ANTHROPIC_API_KEY : process.env.XAI_API_KEY) || null;
}

/** The model every quote uses, as picked in Admin (else the XAI_MODEL setting, else Grok 4.3). */
export const liveModel = cache(async function liveModel(): Promise<string> {
  try {
    const { data } = await createAdminClient().from("platform_settings").select("value").eq("key", "ai_model").maybeSingle();
    const picked = typeof data?.value === "string" ? data.value : null;
    if (picked && modelInfo(picked) && keyFor(picked)) return picked;
  } catch {
    // Fall back below.
  }
  return process.env.XAI_MODEL ?? DEFAULT_MODEL;
});

/** One structured call to whichever model is named. */
export async function structuredCall(model: string, schema: Schema, messages: ChatMessage[]): Promise<ProviderResult> {
  const apiKey = keyFor(model);
  if (!apiKey) throw new Error(`No API key for ${model}.`);
  return providerOf(model) === "anthropic"
    ? anthropicStructured({ apiKey, model, schema, messages })
    : xaiStructured({ apiKey, model, schema, messages });
}

/**
 * A caller for quoting: uses the live model (or the one given), logs usage against the company,
 * and is refused when its trial or plan has lapsed. Null when that model's API key isn't set.
 */
export async function aiCaller(schema: Schema, tenantId: string, userId: string | null, kind: AiKind, model?: string) {
  const m = model ?? (await liveModel());
  if (!keyFor(m)) return null;
  return counted((messages: ChatMessage[]) => structuredCall(m, schema, messages), tenantId, userId, kind);
}

/** True when the live model reads PDFs itself (Claude). */
export async function liveModelReadsPdfs(model?: string) {
  return providerOf(model ?? (await liveModel())) === "anthropic";
}
