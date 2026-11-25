import { describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { backoffSeconds, MAX_ATTEMPTS, runWorkerOnce, type QueueJob, type QueuePort } from "@/lib/worker/run";
import { decryptToken, encryptToken } from "@/lib/crypto/tokens";

function memoryQueue(jobs: QueueJob[]) {
  const state = { done: [] as number[], retried: [] as { id: number; error: string }[], dead: [] as number[] };
  const queue: QueuePort = {
    claim: async () => {
      const j = jobs.shift();
      return j ? { ...j, attempts: j.attempts + 1 } : null;
    },
    done: async (id) => { state.done.push(id); },
    retry: async (id, error) => { state.retried.push({ id, error }); },
    dead: async (id) => { state.dead.push(id); },
  };
  return { queue, state };
}

const job = (id: number, kind: QueueJob["kind"], attempts = 0): QueueJob => ({ id, tenant_id: "t1", kind, payload: {}, attempts });

describe("worker loop", () => {
  it("runs jobs, retries failures with back-off, parks repeat failures", async () => {
    const { queue, state } = memoryQueue([
      job(1, "process_message"),
      job(2, "process_message"),
      job(3, "draft_quote", MAX_ATTEMPTS - 1),
      job(4, "renew_watch"),
    ]);
    const summary = await runWorkerOnce(queue, {
      process_message: async (j) => { if (j.id === 2) throw new Error("Graph 503"); },
      draft_quote: async () => { throw new Error("still failing"); },
    });
    expect(state.done).toEqual([1]);
    expect(state.retried.map((r) => r.id)).toEqual([2, 4]);
    expect(state.retried[1].error).toContain("No handler for renew_watch");
    expect(state.dead).toEqual([3]);
    expect(summary).toEqual({ ran: 1, failed: 2, dead: 1 });
  });

  it("stops at the batch limit", async () => {
    const { queue, state } = memoryQueue([job(1, "catch_up"), job(2, "catch_up"), job(3, "catch_up")]);
    await runWorkerOnce(queue, { catch_up: async () => {} }, 2);
    expect(state.done).toEqual([1, 2]);
  });

  it("backs off 1, 4, 9 minutes and caps at an hour", () => {
    expect([1, 2, 3].map(backoffSeconds)).toEqual([60, 240, 540]);
    expect(backoffSeconds(20)).toBe(3600);
  });
});

describe("token encryption", () => {
  const master = randomBytes(32).toString("base64");

  it("round-trips per tenant", () => {
    const stored = encryptToken("tenant-a", "refresh-token-123", master);
    expect(stored.startsWith("v1.")).toBe(true);
    expect(stored).not.toContain("refresh-token-123");
    expect(decryptToken("tenant-a", stored, master)).toBe("refresh-token-123");
  });

  it("one tenant's key cannot read another tenant's token", () => {
    const stored = encryptToken("tenant-a", "secret", master);
    expect(() => decryptToken("tenant-b", stored, master)).toThrow();
  });

  it("rejects tampering and a bad master key", () => {
    const stored = encryptToken("tenant-a", "secret", master);
    const parts = stored.split(".");
    parts[3] = Buffer.from("tampered").toString("base64url");
    expect(() => decryptToken("tenant-a", parts.join("."), master)).toThrow();
    expect(() => encryptToken("t", "x", Buffer.from("short").toString("base64"))).toThrow("32 bytes");
  });
});
