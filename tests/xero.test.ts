import { describe, expect, it } from "vitest";
import { buildXeroQuote, xeroSummary, findOrCreateContact, xeroAuthorizeUrl, xeroClient, xeroExchangeCode, xeroOrganisation, xeroValidToken, XERO_SCOPES } from "@/lib/xero";

const cfg = { clientId: "cid", clientSecret: "secret", redirectUri: "https://app.example/api/connect/xero/callback" };
function fake(handler: (url: string, init?: RequestInit) => { status?: number; body: unknown }) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const impl = (async (u: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(u), init });
    const r = handler(String(u), init);
    return new Response(JSON.stringify(r.body), { status: r.status ?? 200 });
  }) as typeof fetch;
  return { impl, calls };
}

describe("Xero connection", () => {
  it("asks for granular scopes only (no broad accounting.transactions)", () => {
    const url = new URL(xeroAuthorizeUrl(cfg, "st"));
    expect(url.searchParams.get("scope")).toBe(XERO_SCOPES.join(" "));
    expect(url.searchParams.get("scope")).not.toContain("accounting.transactions");
    expect(url.searchParams.get("state")).toBe("st");
  });
  it("exchanges the code with basic auth and keeps the rotating refresh token", async () => {
    const { impl, calls } = fake(() => ({ body: { access_token: "a1", refresh_token: "r1", expires_in: 1800 } }));
    const t = await xeroExchangeCode(cfg, "code", impl, 0);
    expect(t).toEqual({ access_token: "a1", refresh_token: "r1", expires_at: 1740 * 1000 });
    expect((calls[0].init?.headers as Record<string, string>).Authorization).toBe(`Basic ${Buffer.from("cid:secret").toString("base64")}`);
  });
  it("refreshes an expired token, saves it, and keeps the organisation", async () => {
    const { impl } = fake(() => ({ body: { access_token: "a2", refresh_token: "r2", expires_in: 1800 } }));
    let saved: unknown = null;
    const t = await xeroValidToken(cfg, { access_token: "a1", refresh_token: "r1", expires_at: 0, xero_tenant_id: "org1", org_name: "Demo" }, async (x) => { saved = x; }, impl, 1000);
    expect(t).toMatchObject({ access_token: "a2", refresh_token: "r2", xero_tenant_id: "org1" });
    expect(saved).toEqual(t);
  });
  it("picks the most recently connected organisation", async () => {
    const { impl } = fake(() => ({ body: [
      { tenantId: "old", tenantName: "Old Co", tenantType: "ORGANISATION", updatedDateUtc: "2026-01-01T00:00:00" },
      { tenantId: "new", tenantName: "Demo Company (AU)", tenantType: "ORGANISATION", updatedDateUtc: "2026-11-27T00:00:00" },
      { tenantId: "p", tenantName: "Practice", tenantType: "PRACTICE" },
    ] }));
    expect(await xeroOrganisation("a", impl)).toEqual({ tenantId: "new", name: "Demo Company (AU)" });
  });
});

describe("sending a quote to Xero", () => {
  it("reuses an existing contact by name, or adds one", async () => {
    const found = fake(() => ({ body: { Contacts: [{ ContactID: "c1", Name: "Demo Builders" }] } }));
    expect(await findOrCreateContact(xeroClient("a", "org", found.impl), "demo builders", null)).toBe("c1");
    const added = fake((u, init) => ({ body: init?.method === "PUT" ? { Contacts: [{ ContactID: "c2" }] } : { Contacts: [] } }));
    expect(await findOrCreateContact(xeroClient("a", "org", added.impl), "New Co", "a@b.com")).toBe("c2");
    expect(JSON.parse(String(added.calls[1].init?.body))).toEqual({ Contacts: [{ Name: "New Co", EmailAddress: "a@b.com" }] });
    expect((added.calls[0].init?.headers as Record<string, string>)["xero-tenant-id"]).toBe("org");
  });
  it("builds a DRAFT quote, ex GST with GST on income, lines that add up to ours", () => {
    const body = buildXeroQuote({
      contactId: "c1", quoteNo: "Q-0007", title: "Carpark, Strathpine", siteAddress: "12 Demo St, Strathpine", terms: "Valid 30 days.",
      date: new Date("2026-11-27T02:00:00Z"), existingQuoteId: null,
      lines: [
        { key: "a", description: "Supply and lay AC10, 35 mm", quantity: 168, unit: "t", rate: 276.43, total: 46440 },
        { key: "p", description: "Prime", quantity: 2000, unit: "m²", rate: 2.1, total: 4200 },
      ],
    });
    const q = body.Quotes[0];
    expect(q).toMatchObject({ Status: "DRAFT", LineAmountTypes: "Exclusive", Reference: "Q-0007", Date: "2026-11-27", ExpiryDate: "2026-12-27", Contact: { ContactID: "c1" } });
    expect(q).not.toHaveProperty("QuoteID");
    expect(q.LineItems[0]).toEqual({ Description: "Supply and lay AC10, 35 mm (per t)", Quantity: 168, UnitAmount: 276.4286, TaxType: "OUTPUT" });
    expect(Math.round(168 * 276.4286 * 100) / 100).toBe(46440); // Xero's line total lands on ours
    expect(q.LineItems[1].Description).toBe("Prime (per m2)");
  });
  it("updates the same Xero quote when sent again, and reports Xero's validation errors", async () => {
    const body = buildXeroQuote({ contactId: "c1", quoteNo: "Q-1", title: "T", siteAddress: null, terms: "", date: new Date(), existingQuoteId: "xq1", lines: [] });
    expect(body.Quotes[0].QuoteID).toBe("xq1");
    const bad = fake(() => ({ status: 400, body: { Elements: [{ ValidationErrors: [{ Message: "Contact not found" }] }] } }));
    await expect(xeroClient("a", "org", bad.impl)("/Quotes", { method: "PUT", body })).rejects.toThrow("Xero: Contact not found");
  });
});

describe("Xero quote summary", () => {
  it("lists the site and the scope of works, not just the address", () => {
    const s = xeroSummary({
      title: "Newton Street, Burpengary East", siteAddress: "Newton Street, Burpengary East", quoteNo: "Q-0001",
      lines: [
        { key: "a", description: "Supply and lay AC10 asphalt, 40 mm", quantity: 85.5, unit: "t", rate: 200, total: 17100 },
        { key: "b", description: "Establishment", quantity: 1, unit: "item", rate: 5000, total: 5000 },
        { key: "c", description: "Nothing", quantity: 0, unit: "m²", rate: 0, total: 0 },
      ],
    });
    expect(s).toContain("Site: Newton Street, Burpengary East");
    expect(s).toContain("- Supply and lay AC10 asphalt, 40 mm (85.5 t)");
    expect(s).toContain("- Establishment (1 item)");
    expect(s).not.toContain("Nothing");
    expect(s).toContain("Our ref Q-0001");
  });
});
