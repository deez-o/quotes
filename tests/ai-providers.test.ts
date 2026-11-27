import { describe, expect, it } from "vitest";
import { anthropicStructured, costUsd, xaiStructured, type ChatMessage } from "@/lib/quote/provider";
import { modelInfo, providerOf } from "@/lib/ai/models";

const schema = { name: "site_scope", strict: true, schema: { type: "object", properties: { title: { type: "string" } }, required: ["title"], additionalProperties: false } };
const messages: ChatMessage[] = [
  { role: "system", content: "You are careful." },
  { role: "user", content: [
    { type: "text", text: "Quote this." },
    { type: "image_url", image_url: { url: "https://files.test/site.jpg" } },
    { type: "document_url", document_url: { url: "https://files.test/spec.pdf", name: "spec.pdf" } },
  ] },
];

function fakeFetch(reply: unknown, status = 200) {
  const calls: { url: string; init: RequestInit }[] = [];
  const f = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(reply), { status, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
  return { f, calls };
}

describe("Claude", () => {
  it("sends the system prompt, pictures and PDFs, and makes Claude answer through the schema", async () => {
    const { f, calls } = fakeFetch({ content: [{ type: "tool_use", name: "site_scope", input: { title: "Carpark" } }], usage: { input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 0 } });
    const r = await anthropicStructured({ apiKey: "k", model: "claude-sonnet-5-5", schema, messages, fetchImpl: f });
    expect(r.json).toEqual({ title: "Carpark" });
    expect(r.provider).toBe("anthropic");
    expect(r.usage).toEqual({ input_tokens: 1000, cached_tokens: 0, output_tokens: 200 });
    const body = JSON.parse(String(calls[0].init.body));
    expect(calls[0].url).toBe("https://api.anthropic.com/v1/messages");
    expect((calls[0].init.headers as Record<string, string>)["x-api-key"]).toBe("k");
    expect(body.system).toBe("You are careful.");
    expect(body.tool_choice).toEqual({ type: "tool", name: "site_scope" });
    expect(body.tools[0].input_schema).toEqual(schema.schema);
    expect(body.messages[0].content).toEqual([
      { type: "text", text: "Quote this." },
      { type: "image", source: { type: "url", url: "https://files.test/site.jpg" } },
      { type: "document", source: { type: "url", url: "https://files.test/spec.pdf" }, title: "spec.pdf" },
    ]);
  });

  it("explains API errors and answers that aren't in the schema", async () => {
    await expect(anthropicStructured({ apiKey: "k", model: "claude-sonnet-5-5", schema, messages, fetchImpl: fakeFetch({ error: { message: "bad key" } }, 401).f })).rejects.toThrow(/Claude 401: bad key/);
    await expect(anthropicStructured({ apiKey: "k", model: "claude-sonnet-5-5", schema, messages, fetchImpl: fakeFetch({ content: [{ type: "text", text: "hi" }], stop_reason: "max_tokens" }).f })).rejects.toThrow(/ran out of room/);
  });
});

describe("Grok", () => {
  it("is told about a PDF it can't open instead of being sent it", async () => {
    const { f, calls } = fakeFetch({ choices: [{ message: { content: "{\"title\":\"x\"}" } }], usage: { prompt_tokens: 10, completion_tokens: 5 } });
    await xaiStructured({ apiKey: "k", model: "grok-4.7", schema, messages, fetchImpl: f });
    const body = JSON.parse(String(calls[0].init.body));
    expect(body.messages[1].content[2]).toEqual({ type: "text", text: "(spec.pdf: a PDF this model can't open)" });
  });
});

describe("models", () => {
  it("knows each model's maker and price", () => {
    expect(providerOf("claude-sonnet-5-5")).toBe("anthropic");
    expect(providerOf("grok-4.7")).toBe("xai");
    expect(modelInfo("grok-4.3")?.label).toBe("Grok 4.3");
    expect(costUsd("claude-sonnet-5-5", { input_tokens: 1_000_000, cached_tokens: 0, output_tokens: 100_000 })).toBeCloseTo(3);
    expect(costUsd("grok-4.7", { input_tokens: 1_000_000, cached_tokens: 0, output_tokens: 100_000 })).toBeCloseTo(2.6);
  });
});
