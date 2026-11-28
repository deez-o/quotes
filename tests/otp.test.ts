import { describe, expect, it } from "vitest";
import { codeFromEmail, isPortalCodeEmail } from "@/lib/portal/otp";

describe("portal one-time codes", () => {
  it("finds the code", () => {
    expect(codeFromEmail("Your one-time code", "Hi,\nYour one-time code is: 482913\nIt expires in one hour.")).toBe("482913");
    expect(codeFromEmail("E1 verification", "Use code 7Q4K9X to access the project.")).toBe("7Q4K9X");
    expect(codeFromEmail("Access code", "Enter 551204 to continue. Call 07 3385 3300")).toBe("551204");
  });
  it("only looks at portal emails", () => {
    expect(isPortalCodeEmail("no-reply@estimateone.com", "Your one-time code")).toBe(true);
    expect(isPortalCodeEmail("bob@builder.com", "Your one-time code")).toBe(false);
  });
});
