import { describe, expect, it } from "vitest";
import {
  fromLooseFiles, htmlToText, isEmailFile, parseEml, threadKey, unquoteForward, unwrapForwarded,
} from "@/lib/mail/parse-files";

const enc = (s: string) => new TextEncoder().encode(s);
const b64 = (s: string) => Buffer.from(s).toString("base64");

/** A small RFQ email with a BoQ attachment and a signature logo, as saved from an email app. */
function rfqEml() {
  return [
    "From: Sam Turner <sam@baysidedev.example>",
    "To: sales@demoasphalt.example",
    "Subject: RFQ - Carpark resurfacing, Capalaba",
    "Date: Thu, 26 Nov 2026 08:12:00 +1000",
    "Message-ID: <rfq-123@baysidedev.example>",
    "MIME-Version: 1.0",
    'Content-Type: multipart/mixed; boundary="b1"',
    "",
    "--b1",
    "Content-Type: text/plain; charset=utf-8",
    "",
    "Hi team, please quote the carpark. BoQ attached. 40mm AC 10 mix.",
    "--b1",
    "Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    'Content-Disposition: attachment; filename="BoQ - Carpark.xlsx"',
    "Content-Transfer-Encoding: base64",
    "",
    b64("fake spreadsheet bytes"),
    "--b1",
    "Content-Type: image/png",
    'Content-Disposition: inline; filename="image001.png"',
    "Content-ID: <logo1>",
    "Content-Transfer-Encoding: base64",
    "",
    b64("png"),
    "--b1--",
    "",
  ].join("\r\n");
}

describe("saved email files", () => {
  it("reads a .eml with attachments, marking inline images", async () => {
    const { message, files } = await parseEml(enc(rfqEml()), "u1");
    expect(message.from).toBe("sam@baysidedev.example");
    expect(message.subject).toBe("RFQ - Carpark resurfacing, Capalaba");
    expect(message.bodyText).toContain("please quote the carpark");
    expect(message.receivedAt).toBe("2026-11-25T22:12:00.000Z");
    expect(message.attachments.map((a) => [a.name, a.isInline])).toEqual([["BoQ - Carpark.xlsx", false], ["image001.png", true]]);
    expect(new TextDecoder().decode(files.get(message.attachments[0].id))).toBe("fake spreadsheet bytes");
    expect(message.conversationId).toBe(threadKey("sam@baysidedev.example", "RE: RFQ - Carpark resurfacing, Capalaba"));
  });

  it("falls back to the HTML body when there is no plain text", async () => {
    const raw = [
      "From: a@b.example", "Subject: Pricing please", "Content-Type: text/html; charset=utf-8", "",
      "<p>Please price <b>6,400 m2</b> C170 seal.</p><p>Thanks&nbsp;Ana</p>",
    ].join("\r\n");
    const { message } = await parseEml(enc(raw), "u2");
    expect(message.bodyText).toBe("Please price 6,400 m2 C170 seal.\nThanks Ana");
  });

  it("recognises email files", () => {
    expect(isEmailFile("RFQ.eml", "")).toBe(true);
    expect(isEmailFile("RFQ.MSG", "")).toBe(true);
    expect(isEmailFile("x", "message/rfc822")).toBe(true);
    expect(isEmailFile("BoQ.xlsx", "application/xlsx")).toBe(false);
  });
});

describe("forwarded emails", () => {
  it("reads Outlook's forward header", () => {
    const body = [
      "Can you quote this one please. Dan",
      "",
      "________________________________",
      "From: Sam Turner <sam@baysidedev.example>",
      "Sent: Thursday, 26 November 2026 8:12 AM",
      "To: Sales <sales@demoasphalt.example>",
      "Subject: RFQ - Carpark resurfacing, Capalaba",
      "",
      "Hi team, please quote the carpark.",
    ].join("\n");
    const q = unquoteForward(body);
    expect(q).toMatchObject({ from: "sam@baysidedev.example", subject: "RFQ - Carpark resurfacing, Capalaba" });
    expect(q.body).toBe("Hi team, please quote the carpark.");
  });

  it("reads Gmail's forward header", () => {
    const body = [
      "---------- Forwarded message ---------",
      "From: Priya <estimating@northpointcivil.example>",
      "Date: Thu, 26 Nov 2026 at 09:40",
      "Subject: Request for quotation: Stage 3 subdivision, Narangba",
      "To: <sales@demoasphalt.example>",
      "",
      "We invite you to submit pricing.",
    ].join("\n");
    expect(unquoteForward(body)).toMatchObject({
      from: "estimating@northpointcivil.example",
      subject: "Request for quotation: Stage 3 subdivision, Narangba",
      body: "We invite you to submit pricing.",
    });
  });

  it("unwraps an email forwarded with the RFQ quoted in the body, keeping attachments", async () => {
    const outerRaw = [
      "From: Dan <dan@demoasphalt.example>",
      "To: demo-asphalt@in.quotes.example",
      "Subject: FW: RFQ - Carpark resurfacing, Capalaba",
      'Content-Type: multipart/mixed; boundary="o1"',
      "",
      "--o1",
      "Content-Type: text/plain",
      "",
      "Quote this please",
      "",
      "From: Sam Turner <sam@baysidedev.example>",
      "Sent: Thursday, 26 November 2026 8:12 AM",
      "Subject: RFQ - Carpark resurfacing, Capalaba",
      "",
      "Hi team, please quote the carpark.",
      "--o1",
      "Content-Type: application/pdf",
      'Content-Disposition: attachment; filename="C-101.pdf"',
      "Content-Transfer-Encoding: base64",
      "",
      b64("%PDF fake"),
      "--o1--",
    ].join("\r\n");
    const outer = await parseEml(enc(outerRaw), "f1");
    const r = await unwrapForwarded(outer, "f1");
    expect(r.forwardedBy).toBe("dan@demoasphalt.example");
    expect(r.note).toBe("Quote this please");
    expect(r.message.from).toBe("sam@baysidedev.example");
    expect(r.message.subject).toBe("RFQ - Carpark resurfacing, Capalaba");
    expect(r.message.bodyText).toBe("Hi team, please quote the carpark.");
    expect(r.message.attachments.map((a) => a.name)).toEqual(["C-101.pdf"]);
    expect(r.message.conversationId).toBe(threadKey("sam@baysidedev.example", "RFQ - Carpark resurfacing, Capalaba"));
  });

  it("unwraps an email forwarded as an attachment, plus extra files", async () => {
    const outerRaw = [
      "From: Dan <dan@demoasphalt.example>",
      "Subject: FW: RFQ",
      'Content-Type: multipart/mixed; boundary="o2"',
      "",
      "--o2",
      "Content-Type: text/plain",
      "",
      "See attached RFQ, and the drawing they sent separately.",
      "--o2",
      "Content-Type: message/rfc822",
      'Content-Disposition: attachment; filename="RFQ.eml"',
      "",
      rfqEml(),
      "--o2",
      "Content-Type: application/pdf",
      'Content-Disposition: attachment; filename="C-201.pdf"',
      "Content-Transfer-Encoding: base64",
      "",
      b64("%PDF 2"),
      "--o2--",
    ].join("\r\n");
    const outer = await parseEml(enc(outerRaw), "f2");
    const r = await unwrapForwarded(outer, "f2");
    expect(r.message.from).toBe("sam@baysidedev.example");
    expect(r.message.subject).toBe("RFQ - Carpark resurfacing, Capalaba");
    expect(r.message.attachments.map((a) => a.name)).toEqual(["BoQ - Carpark.xlsx", "image001.png", "C-201.pdf"]);
    expect(r.note).toContain("See attached RFQ");
    expect(r.files.size).toBe(3);
  });
});

describe("loose files and pasted text", () => {
  it("uses a pasted forward header when there is one", () => {
    const r = fromLooseFiles({
      files: [{ name: "BoQ.xlsx", type: "application/xlsx", bytes: enc("x") }],
      pastedText: "From: Ana <ana@coastalcivil.example>\nSubject: RFQ Ferry Road Ripley\n\nPlease quote asphalt and prime.",
      uploader: "dan@demoasphalt.example",
      idPrefix: "p1",
    });
    expect(r.message).toMatchObject({ from: "ana@coastalcivil.example", subject: "RFQ Ferry Road Ripley", bodyText: "Please quote asphalt and prime." });
    expect(r.message.attachments).toHaveLength(1);
  });

  it("falls back to the first line, or the first file name", () => {
    const a = fromLooseFiles({ files: [], pastedText: "Carpark at 22 Old Cleveland Rd\nAC10 40mm 1850 m2", uploader: "dan@x.example", idPrefix: "p2" });
    expect(a.message.subject).toBe("Carpark at 22 Old Cleveland Rd");
    expect(a.message.from).toBe("dan@x.example");
    const b = fromLooseFiles({ files: [{ name: "Tender pack.pdf", type: "application/pdf", bytes: enc("x") }], pastedText: "", uploader: "dan@x.example", idPrefix: "p3" });
    expect(b.message.subject).toBe("Uploaded RFQ: Tender pack.pdf");
  });

  it("converts simple HTML to text", () => {
    expect(htmlToText("<div>Line 1</div><div>Line&nbsp;2 &amp; more</div>")).toBe("Line 1\nLine 2 & more");
  });
});
