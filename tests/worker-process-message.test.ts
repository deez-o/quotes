import { describe, expect, it } from "vitest";
import { LABELS, processMessage, shortEmailName, storagePath, type MailboxPort, type StorePort } from "@/lib/worker/process-message";
import { demoEmails } from "./fixtures/demo-emails";

const TENANT = "00000000-0000-4000-8000-000000000001";

/** In-memory mailbox + store standing in for Microsoft Graph and Supabase. */
function harness() {
  const byId = new Map(demoEmails.map((e) => [e.id, structuredClone(e)]));
  const labels = new Map<string, string[]>();
  const mailbox: MailboxPort = {
    getMessage: async (id) => structuredClone(byId.get(id)!),
    // Bytes derived from the fixture's hash, so identical files get identical hashes.
    downloadAttachment: async (mid, aid) => {
      const a = byId.get(mid)!.attachments.find((x) => x.id === aid)!;
      return new TextEncoder().encode(`file:${a.sha256}`);
    },
    addCategories: async (mid, _existing, add) => { labels.set(mid, add); },
  };

  const seen = new Set<string>();
  const conv = new Map<string, string>();
  const hashes = new Map<string, string>();
  const files = new Map<string, number>();
  const drafts: string[] = [];
  let n = 0;
  const store: StorePort = {
    isSeen: async (_t, _c, id) => seen.has(id),
    jobForConversation: async (_t, c) => conv.get(c) ?? null,
    jobForContentHash: async (_t, h) => hashes.get(h) ?? null,
    createJob: async () => { n++; return { jobId: `job-${n}`, quoteNo: `Q-${String(n).padStart(4, "0")}` }; },
    saveMessage: async (row) => {
      seen.add(row.provider_message_id);
      if (row.job_id) {
        if (!conv.has(row.thread_id)) conv.set(row.thread_id, row.job_id);
        if (!hashes.has(row.content_hash)) hashes.set(row.content_hash, row.job_id);
      }
    },
    putFile: async (path, bytes) => { files.set(path, bytes.byteLength); },
    saveAttachment: async () => {},
    enqueueDraft: async (_t, jobId) => { drafts.push(jobId); },
  };
  return { mailbox, store, labels, files, drafts };
}

describe("processMessage on the demo inbox", () => {
  it("handles every demo email as expected, in arrival order", async () => {
    const h = harness();
    const ordered = [...demoEmails].sort((a, b) => Date.parse(a.receivedAt) - Date.parse(b.receivedAt));
    const results = [];
    for (const e of ordered) {
      const r = await processMessage({ tenantId: TENANT, connectionId: "conn1", messageId: e.id }, h.mailbox, h.store);
      expect([e.id, r.action, r.category]).toEqual([e.id, e.expect.link, e.expect.category]);
      results.push(r);
    }

    const newJobs = results.filter((r) => r.action === "new_job");
    expect(newJobs.map((r) => r.quoteNo)).toEqual(["Q-0001", "Q-0002", "Q-0003", "Q-0004", "Q-0005", "Q-0006"]);

    // Labels in Outlook
    expect(h.labels.get("m01")).toEqual([LABELS.toBeQuoted]);
    expect(h.labels.get("m03")).toEqual([LABELS.duplicate]);
    expect(h.labels.get("m09")).toEqual([LABELS.award]);
    expect(h.labels.get("m10")).toEqual([LABELS.invoice]);
    expect(h.labels.has("m11")).toBe(false);

    // Signature logo skipped, pasted quantity picture kept
    const pictures = results[ordered.findIndex((e) => e.id === "m06")];
    expect(pictures.skipped).toEqual(["image001.png (signature image)"]);
    expect([...h.files.keys()].some((p) => p.endsWith("/0. Incoming/image002.png"))).toBe(true);

    // Revision filed into the original job; duplicate not re-filed or re-drafted
    const carparkJob = results[ordered.findIndex((e) => e.id === "m01")].jobId;
    const revision = results[ordered.findIndex((e) => e.id === "m04")];
    expect(revision.jobId).toBe(carparkJob);
    expect([...h.files.keys()].some((p) => p.includes(`/${carparkJob}/4. Correspondence/Reply - `))).toBe(true);
    expect(h.drafts.filter((j) => j === carparkJob)).toHaveLength(2); // re-draft after the revision
    const dup = results[ordered.findIndex((e) => e.id === "m03")];
    expect(dup.filesSaved).toBe(0);

    // Every stored path sits under the tenant
    expect([...h.files.keys()].every((p) => p.startsWith(`${TENANT}/`))).toBe(true);
  });

  it("does nothing the second time a message is processed", async () => {
    const h = harness();
    await processMessage({ tenantId: TENANT, connectionId: "conn1", messageId: "m01" }, h.mailbox, h.store);
    const again = await processMessage({ tenantId: TENANT, connectionId: "conn1", messageId: "m01" }, h.mailbox, h.store);
    expect(again.action).toBe("already_seen");
  });
});

describe("naming", () => {
  it("gives emails short, clear names", () => {
    expect(shortEmailName("RE: RFQ - Carpark resurfacing, 22 Old Cleveland Rd Capalaba", "Reply"))
      .toBe("Reply - Carpark Resurfacing, 22 Old Cleveland Rd Capalaba.eml");
    expect(shortEmailName("Request for quotation: Stage 3 subdivision, Narangba"))
      .toBe("RFQ - Stage 3 Subdivision, Narangba.eml");
    expect(shortEmailName("RFQ")).toBe("RFQ - Untitled.eml");
  });

  it("keeps storage paths inside the tenant and strips unsafe characters", () => {
    expect(storagePath("t1", "j1", "2. BOQ", "a/b:c?.xlsx")).toBe("t1/j1/2. BOQ/a_b_c_.xlsx");
  });
});
