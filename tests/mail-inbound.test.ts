import { describe, expect, it } from "vitest";
import { handleInbound, recipientLocalPart, type InboundDeps } from "@/lib/mail/inbound";

const enc = (s: string) => new TextEncoder().encode(s);
const TENANT = "00000000-0000-4000-8000-000000000001";

function deps(overrides: Partial<InboundDeps> = {}) {
  const stored: string[] = [];
  const queued: string[] = [];
  const d: InboundDeps = {
    domain: "in.quotes.example",
    tenantForLocalPart: async (l) => (l === "demo-asphalt" ? TENANT : null),
    isTeamMember: async (_t, email) => email === "dan@demoasphalt.example",
    store: async (t, id) => { const p = `${t}/inbound/${id}.eml`; stored.push(p); return p; },
    enqueue: async (_t, _id, path) => { queued.push(path); },
    newId: () => "in-1",
    ...overrides,
  };
  return { d, stored, queued };
}

const forward = (from: string, to = "demo-asphalt@in.quotes.example") =>
  enc([`From: ${from}`, `To: ${to}`, "Subject: FW: RFQ carpark", "Content-Type: text/plain", "", "Quote this please"].join("\r\n"));

describe("forwarding address", () => {
  it("queues a forward from someone on the team", async () => {
    const { d, stored, queued } = deps();
    const r = await handleInbound(forward("Dan <dan@demoasphalt.example>"), null, d);
    expect(r).toEqual({ status: "queued", tenantId: TENANT, inboundId: "in-1" });
    expect(stored).toEqual([`${TENANT}/inbound/in-1.eml`]);
    expect(queued).toEqual(stored);
  });

  it("drops emails from anyone outside the team", async () => {
    const { d, queued } = deps();
    expect(await handleInbound(forward("spammer@bad.example"), null, d)).toEqual({ status: "ignored", reason: "sender is not on the team" });
    expect(queued).toHaveLength(0);
  });

  it("drops unknown addresses and other domains", async () => {
    const { d } = deps();
    expect((await handleInbound(forward("dan@demoasphalt.example", "someone@in.quotes.example"), null, d)).status).toBe("ignored");
    expect((await handleInbound(forward("dan@demoasphalt.example", "sales@other.example"), null, d)).status).toBe("ignored");
  });

  it("prefers the envelope recipient (when the To header is the original customer)", async () => {
    const { d } = deps();
    const r = await handleInbound(forward("dan@demoasphalt.example", "sales@demoasphalt.example"), "demo-asphalt@in.quotes.example", d);
    expect(r.status).toBe("queued");
  });

  it("handles plus-addressing and display names", () => {
    expect(recipientLocalPart("in.quotes.example", null, ["Quotes <Demo-Asphalt+carparks@IN.quotes.example>"])).toBe("demo-asphalt");
    expect(recipientLocalPart("in.quotes.example", null, ["x@elsewhere.example"])).toBeNull();
  });

  it("ignores empty bodies", async () => {
    expect(await handleInbound(new Uint8Array(), null, deps().d)).toEqual({ status: "ignored", reason: "empty" });
  });
});
