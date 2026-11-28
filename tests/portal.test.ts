import { describe, expect, it } from "vitest";
import { detectPortal, unwrapLink } from "@/lib/rfq/portal";

const safe = (u: string) => `https://aus01.safelinks.protection.outlook.com/?url=${encodeURIComponent(u)}&data=x`;
const E1 = `Smith Civil has invited you to tender:

12 Example St, Springfield (Project #1234)

Access Documentation → <${safe("https://app.estimateone.com/s/smith/invite/abc?login=tok")}>
WE HAVE DOCS <${safe("https://app.estimateone.com/s/smith/invite/abc?login=tok&d=already")}>
✔ QUOTING <${safe("https://app.estimateone.com/s/smith/invite/abc?login=tok&d=quoting")}>

Dear Sales,

Smith Civil is inviting Demo Asphalt to Tender on the Asphalt package for 12 Example St, Springfield.

The quote for this package is due: Fri 4 Dec 2026

Kind regards,

Jane Citizen
jane@smithcivil.example<mailto:jane@smithcivil.example>
Smith Civil
0400 000 000
`;

describe("tender portals", () => {
  it("unwraps Outlook safe links", () => {
    expect(unwrapLink(safe("https://app.estimateone.com/x?y=1"))).toBe("https://app.estimateone.com/x?y=1");
  });
  it("reads an EstimateOne invite", () => {
    const p = detectPortal(E1, "Smith Civil <docs@estimateone.com>")!;
    expect(p.portal).toBe("EstimateOne");
    expect(p.docsUrl).toBe("https://app.estimateone.com/s/smith/invite/abc?login=tok");
    expect(p.builder).toBe("Smith Civil");
    expect(p.contactEmail).toBe("jane@smithcivil.example");
    expect(p.contactName).toBe("Jane Citizen");
    expect(p.contactPhone).toBe("0400 000 000");
    expect(p.due).toBe("Fri 4 Dec 2026");
    expect(p.project).toContain("12 Example St, Springfield");
  });
  it("ignores an ordinary email", () => {
    expect(detectPortal("Hi, please quote 200m2 AC10 at 5 Smith St. Thanks")).toBeNull();
  });
});
