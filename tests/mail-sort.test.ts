import { describe, expect, it } from "vitest";
import {
  contentHash, decideLink, documentLinks, isSignatureImage, isUnsafeLink, normaliseSubject, sortMessage, type KnownMail,
} from "@/lib/mail/sort";
import { demoEmails } from "./fixtures/demo-emails";

describe("inbox sorting on the demo inbox", () => {
  it.each(demoEmails.map((e) => [e.id, e.subject, e] as const))("%s %s", (_id, _s, email) => {
    expect(sortMessage(email).category).toBe(email.expect.category);
  });
});

describe("job linking: replay the demo inbox in arrival order", () => {
  it("creates, attaches and de-duplicates as expected, and is safe to re-run", () => {
    const known: KnownMail = { seenMessageIds: new Set(), jobByConversation: new Map(), jobByContentHash: new Map() };
    const ordered = [...demoEmails].sort((a, b) => Date.parse(a.receivedAt) - Date.parse(b.receivedAt));
    let jobs = 0;

    for (const email of ordered) {
      const { category } = sortMessage(email);
      const d = decideLink(email, category, known);
      const expected = email.expect.link;
      expect([email.id, d.action]).toEqual([email.id, expected]);

      known.seenMessageIds.add(email.id);
      if (d.action === "new_job") {
        const jobId = `job-${++jobs}`;
        known.jobByConversation.set(email.conversationId, jobId);
        known.jobByContentHash.set(contentHash(email), jobId);
      }
      if (d.action === "duplicate") known.jobByConversation.set(email.conversationId, d.jobId);
    }

    // Re-running every message does nothing (notifications can arrive twice).
    for (const email of ordered) {
      expect(decideLink(email, sortMessage(email).category, known).action).toBe("already_seen");
    }
    expect(jobs).toBe(6);
  });
});

describe("helpers", () => {
  it("normalises reply and forward subjects", () => {
    expect(normaliseSubject("RE: FW:  RFQ - Carpark ")).toBe("rfq - carpark");
  });

  it("drops signature logos but keeps pasted quantity pictures", () => {
    const pics = demoEmails.find((e) => e.id === "m06")!.attachments;
    expect(pics.filter((a) => !isSignatureImage(a)).map((a) => a.name)).toEqual(["image002.png"]);
  });

  it("follows document links but never decline links", () => {
    const portal = demoEmails.find((e) => e.id === "m07")!;
    expect(documentLinks(portal.bodyText)).toEqual(["https://app.estimateone.example/tender/12345/documents"]);
    expect(isUnsafeLink("https://app.estimateone.example/tender/12345/decline")).toBe(true);
  });
});

describe("pictures pasted into the email", () => {
  const pic = (name: string, size: number) => ({ id: name, name, contentType: "image/png", size, isInline: true });
  it("keeps a small picture the text points at, drops the signature logo", () => {
    const body = "Could you please quote.\n2. Areas =\n[cid:image001.png@01DD7CC5.11BB6C00]\n\nThanks\n[cid:image002.gif@01DD7CC5.11BB6C00]\nAna Franco";
    expect(isSignatureImage(pic("image001.png", 9_000), body)).toBe(false);
    expect(isSignatureImage({ ...pic("image002.gif", 9_000), contentType: "image/gif" }, body)).toBe(true);
    expect(isSignatureImage(pic("image009.png", 6_000), "Kind regards\n[cid:image009.png@x]")).toBe(true);
  });
});

describe("pictures that didn't come through", () => {
  it("flags a picture the email points at that isn't attached", async () => {
    const { missingPictures } = await import("@/lib/mail/sort");
    const body = "2. Areas =\n[cid:image001.png@01DD7CC5.11BB6C00]\n\nKind regards,\n[cid:image002.gif@01DD7CC5.11BB6C00]";
    expect(missingPictures(body, [])).toEqual(["image001.png"]);
    expect(missingPictures(body, ["image001.png"])).toEqual([]);
  });
});
