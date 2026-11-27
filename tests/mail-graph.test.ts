import { describe, expect, it } from "vitest";
import { GraphMailbox, toIncomingMessage } from "@/lib/mail/graph";
import { handleGraphNotifications, type QueueInsert } from "@/lib/mail/notifications";

type Call = { url: string; method: string; body: unknown; headers: Record<string, string> };

function fakeFetch(responses: Record<string, unknown>) {
  const calls: Call[] = [];
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined, headers: (init?.headers ?? {}) as Record<string, string> });
    const key = Object.keys(responses).find((k) => url.includes(k));
    const data = key ? responses[key] : {};
    return new Response(JSON.stringify(data), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  return { impl, calls };
}

describe("Graph mailbox adapter", () => {
  it("reads a message as plain text with its attachments", async () => {
    const { impl, calls } = fakeFetch({
      "/attachments": { value: [{ id: "a1", name: "BoQ.xlsx", contentType: "application/xlsx", size: 1200, isInline: false }] },
      "/messages/m1": {
        id: "m1", conversationId: "c1", subject: "RFQ carpark", receivedDateTime: "2026-11-26T08:12:00Z",
        from: { emailAddress: { address: "sam@baysidedev.example" } },
        toRecipients: [{ emailAddress: { address: "sales@demo.example" } }],
        body: { contentType: "text", content: "Please quote" }, hasAttachments: true,
      },
    });
    const box = new GraphMailbox(async () => "token", "me", impl);
    const msg = await box.getMessage("m1");
    expect(msg).toMatchObject({ id: "m1", conversationId: "c1", from: "sam@baysidedev.example", bodyText: "Please quote" });
    expect(msg.attachments[0]).toMatchObject({ name: "BoQ.xlsx", isInline: false });
    expect(calls[0].headers.Prefer).toBe('outlook.body-content-type="text"');
    expect(calls[0].headers.Authorization).toBe("Bearer token");
  });

  it("subscribes to new inbox mail with a client secret", async () => {
    const { impl, calls } = fakeFetch({ "/subscriptions": { id: "s1", expirationDateTime: "2026-11-27T00:00:00Z" } });
    const box = new GraphMailbox(async () => "t", "me", impl);
    await box.createInboxSubscription("https://quotes.example/api/webhooks/graph", "secret", new Date("2026-11-27T00:00:00Z"));
    expect(calls[0].method).toBe("POST");
    expect(calls[0].body).toMatchObject({ changeType: "created", resource: "/me/mailFolders('inbox')/messages", clientState: "secret" });
  });

  it("adds categories without dropping the user's own", async () => {
    const { impl, calls } = fakeFetch({});
    const box = new GraphMailbox(async () => "t", "me", impl);
    await box.addCategories("m1", ["Red"], ["Quotr/1. To Be Quoted", "Red"]);
    expect(calls[0].body).toEqual({ categories: ["Red", "Quotr/1. To Be Quoted"] });
  });

  it("maps missing fields safely", () => {
    const m = toIncomingMessage({ id: "x", conversationId: "c", receivedDateTime: "2026-01-01T00:00:00Z" }, []);
    expect(m).toMatchObject({ from: "", subject: "", bodyText: "", to: "" });
  });
});

describe("notification handling", () => {
  const watch = { tenant_id: "t1", connection_id: "conn1" };
  const deps = (queued: QueueInsert[]) => ({
    clientState: "s3cret",
    findWatch: async (id: string) => (id === "sub1" ? watch : null),
    enqueue: async (jobs: QueueInsert[]) => { queued.push(...jobs); },
  });

  it("queues new mail once per message", async () => {
    const queued: QueueInsert[] = [];
    const r = await handleGraphNotifications({
      value: [
        { subscriptionId: "sub1", clientState: "s3cret", changeType: "created", resourceData: { id: "m1" } },
        { subscriptionId: "sub1", clientState: "s3cret", changeType: "created", resourceData: { id: "m2" } },
      ],
    }, deps(queued));
    expect(r).toEqual({ queued: 2, ignored: 0, rejected: 0 });
    expect(queued[0]).toMatchObject({ tenant_id: "t1", kind: "process_message", dedupe_key: "conn1:m1" });
  });

  it("rejects a wrong secret and ignores unknown subscriptions", async () => {
    const queued: QueueInsert[] = [];
    const r = await handleGraphNotifications({
      value: [
        { subscriptionId: "sub1", clientState: "wrong", changeType: "created", resourceData: { id: "m1" } },
        { subscriptionId: "other", clientState: "s3cret", changeType: "created", resourceData: { id: "m1" } },
      ],
    }, deps(queued));
    expect(r).toEqual({ queued: 0, ignored: 1, rejected: 1 });
    expect(queued).toHaveLength(0);
  });

  it("turns lifecycle events into renew and catch-up jobs", async () => {
    const queued: QueueInsert[] = [];
    await handleGraphNotifications({
      value: [
        { subscriptionId: "sub1", clientState: "s3cret", lifecycleEvent: "reauthorizationRequired" },
        { subscriptionId: "sub1", clientState: "s3cret", lifecycleEvent: "missed" },
      ],
    }, deps(queued));
    expect(queued.map((j) => j.kind)).toEqual(["renew_watch", "catch_up"]);
  });

  it("ignores junk bodies", async () => {
    expect(await handleGraphNotifications(null, deps([]))).toEqual({ queued: 0, ignored: 0, rejected: 0 });
  });
});
