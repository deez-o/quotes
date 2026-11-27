import { describe, expect, it } from "vitest";
import { defaultSubject, fillMessage, fromName, messageHtml, parseAddresses, pdfName } from "@/lib/quote/email";
import { pdfSafe, quotePdf } from "@/lib/quote/pdf";

const facts = { business: "Demo Asphalt", quoteNo: "Q-0012", job: "Carpark resurfacing", customer: "Sam Turner", totalIncGst: 12100, totalExGst: 11000, sender: "Dan", senderEmail: "dan@demo.test", phone: "0400 000 000" };

describe("quote email", () => {
  it("reads addresses however they're typed", () => {
    const r = parseAddresses("Sam Turner <Sam@Builder.com.au>; pm@builder.com.au,\nsam@builder.com.au  bad@ nope");
    expect(r.valid).toEqual(["sam@builder.com.au", "pm@builder.com.au"]);
    expect(r.invalid).toEqual(["bad@"]);
    expect(parseAddresses(Array.from({ length: 12 }, (_, i) => `a${i}@x.com`).join(","), 10).tooMany).toBe(true);
  });
  it("fills in the message and subject", () => {
    const m = fillMessage(null, facts);
    expect(m).toContain("Hi Sam,");
    expect(m).toContain("Q-0012 for Carpark resurfacing");
    expect(m).toContain("$12,100.00 inc GST ($11,000.00 ex GST)");
    expect(m).toContain("or call 0400 000 000.");
    expect(m).not.toMatch(/\{\w+\}/);
    expect(fillMessage("Hi {customer}, see {unknown}", { ...facts, customer: "Acme Builders Pty Ltd" })).toBe("Hi Acme Builders Pty Ltd, see {unknown}");
    expect(fillMessage(null, { ...facts, phone: null })).toContain("reply to this email.");
    expect(defaultSubject(facts)).toBe("Quote Q-0012 - Carpark resurfacing - Demo Asphalt");
  });
  it("keeps headers and HTML safe", () => {
    expect(fromName('Evil "Co" <x@y>\r\nBcc: z')).toBe("Evil Co x@y Bcc: z");
    expect(messageHtml("<script>x</script>", "A&B", "javascript:")).not.toContain("<script>");
    expect(pdfName("Q-1", "Job / site")).toBe("Quote Q-1 - Job _ site.pdf");
  });
});

describe("quote PDF", () => {
  it("makes a PDF, over pages when long, with odd characters", async () => {
    expect(pdfSafe("40 m² — “ok” ✅")).toBe("40 m² — “ok” ?");
    const bytes = await quotePdf({
      brand: "#C2410C", business: { name: "Demo Asphalt", abn: "12 345 678 901", address: "1 Demo St, Brisbane", contact: "0400 000 000" }, logo: null,
      quote: { number: "Q-0012", date: "28 November 2026", title: "Carpark resurfacing 🚧", customer: "Sam", customerEmail: "sam@x.com", site: "2 Test Rd" },
      lines: Array.from({ length: 60 }, (_, i) => ({ description: `Supply and lay AC10 at 40 mm, line ${i} with a fairly long description that has to wrap`, quantity: 1850, unit: "m²", rate: 32.5, total: 60125 })),
      totals: { exGst: 60125, gst: 6012.5, incGst: 66137.5, gstPercent: 10 }, terms: "Valid 30 days.\n\nBitumen rise and fall applies.",
    });
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
    expect(bytes.length).toBeGreaterThan(3000);
  });
});
