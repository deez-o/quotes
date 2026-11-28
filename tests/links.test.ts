import { describe, expect, it } from "vitest";
import { findDocLinks } from "@/lib/rfq/links";

const safe = (u: string) => `https://aus01.safelinks.protection.outlook.com/?url=${encodeURIComponent(u)}&data=x`;

describe("linked documents", () => {
  it("finds SharePoint, Dropbox and Drive links, through safe links", () => {
    const body = `Drawings: <${safe("https://builder.sharepoint.com/:f:/s/Tenders/EabcDEF?e=x1")}>\nSpec https://www.dropbox.com/scl/fi/abc/spec.pdf?rlkey=k&dl=0 and https://drive.google.com/file/d/1AbCdEfGhIjKlMn/view`;
    expect(findDocLinks(body).map((l) => l.kind)).toEqual(["microsoft", "dropbox", "gdrive"]);
    expect(findDocLinks(body)[0].url).toBe("https://builder.sharepoint.com/:f:/s/Tenders/EabcDEF?e=x1");
  });
  it("ignores an email signature's company site", () => {
    expect(findDocLinks("Regards, https://builder.com.au")).toEqual([]);
  });
});
