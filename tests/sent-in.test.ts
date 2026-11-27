import { describe, expect, it } from "vitest";
import { messageFromForward, messageFromUpload } from "@/lib/worker/sent-in";
import { inMemoryMailbox, processMessage, type StorePort } from "@/lib/worker/process-message";

const enc = (s: string) => new TextEncoder().encode(s);
const b64 = (s: string) => Buffer.from(s).toString("base64");
const TENANT = "00000000-0000-4000-8000-000000000001";

const savedRfq = [
  "From: Sam Turner <sam@baysidedev.example>",
  "Subject: RFQ - Carpark resurfacing, Capalaba",
  "Date: Thu, 26 Nov 2026 08:12:00 +1000",
  'Content-Type: multipart/mixed; boundary="b1"',
  "",
  "--b1",
  "Content-Type: text/plain",
  "",
  "Please quote the carpark. BoQ attached.",
  "--b1",
  "Content-Type: application/vnd.ms-excel",
  'Content-Disposition: attachment; filename="BoQ.xlsx"',
  "Content-Transfer-Encoding: base64",
  "",
  b64("boq"),
  "--b1--",
].join("\r\n");

function memoryStore() {
  const created: { source: string }[] = [];
  const files: string[] = [];
  const store: StorePort = {
    isSeen: async () => false,
    jobForConversation: async () => null,
    jobForContentHash: async () => null,
    createJob: async (_t, input) => { created.push({ source: input.source }); return { jobId: `job-${created.length}`, quoteNo: `Q-000${created.length}` }; },
    saveMessage: async () => {},
    putFile: async (path) => { files.push(path); },
    saveAttachment: async () => {},
    enqueueDraft: async () => {},
  };
  return { store, created, files };
}

describe("drag-in uploads", () => {
  it("uses a dropped email file as the RFQ, adds the other files, keeps the estimator's note", async () => {
    const parsed = await messageFromUpload(
      [
        { name: "RFQ - Carpark.eml", type: "message/rfc822", bytes: enc(savedRfq) },
        { name: "C-101.pdf", type: "application/pdf", bytes: enc("%PDF") },
      ],
      "Customer rang, wants night works.",
      "dan@demoasphalt.example",
      "u1",
    );
    expect(parsed.message.from).toBe("sam@baysidedev.example");
    expect(parsed.message.attachments.map((a) => a.name)).toEqual(["BoQ.xlsx", "C-101.pdf"]);
    expect(parsed.message.bodyText).toContain("[Note from estimator]\nCustomer rang, wants night works.");
    expect(parsed.files.size).toBe(2);
  });

  it("files loose documents as a new job even when the text doesn't look like an RFQ", async () => {
    const parsed = await messageFromUpload(
      [{ name: "Tender pack.pdf", type: "application/pdf", bytes: enc("%PDF") }],
      "Stage 4 roads, Narangba",
      "dan@demoasphalt.example",
      "u2",
    );
    const { store, created, files } = memoryStore();
    const r = await processMessage(
      { tenantId: TENANT, connectionId: "upload-conn", messageId: parsed.message.id },
      inMemoryMailbox(parsed.message, parsed.files), store, { source: "upload", forceRfq: true },
    );
    expect(r).toMatchObject({ action: "new_job", category: "rfq", quoteNo: "Q-0001", labels: [] });
    expect(created).toEqual([{ source: "upload" }]);
    expect(files.some((p) => p.endsWith("/0. Incoming/Tender pack.pdf"))).toBe(true);
  });
});

describe("forwarded to the quoteout address", () => {
  it("unwraps the original RFQ and files it as a forwarded job", async () => {
    const raw = [
      "From: Dan <dan@demoasphalt.example>",
      "To: demo-asphalt@in.quotes.example",
      "Subject: FW: RFQ - Carpark resurfacing, Capalaba",
      'Content-Type: multipart/mixed; boundary="o1"',
      "",
      "--o1",
      "Content-Type: text/plain",
      "",
      "Quote this please",
      "--o1",
      "Content-Type: message/rfc822",
      'Content-Disposition: attachment; filename="RFQ.eml"',
      "",
      savedRfq,
      "--o1--",
    ].join("\r\n");
    const fwd = await messageFromForward(enc(raw), "i1");
    expect(fwd.forwardedBy).toBe("dan@demoasphalt.example");
    expect(fwd.message.from).toBe("sam@baysidedev.example");
    expect(fwd.message.bodyText).toContain("[Note from dan@demoasphalt.example]\nQuote this please");

    const { store, created } = memoryStore();
    const r = await processMessage(
      { tenantId: TENANT, connectionId: "fwd-conn", messageId: fwd.message.id },
      inMemoryMailbox(fwd.message, fwd.files), store, { source: "forward", forceRfq: true },
    );
    expect(r.action).toBe("new_job");
    expect(created).toEqual([{ source: "forward" }]);
  });
});
