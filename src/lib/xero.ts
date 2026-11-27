/**
 * Xero: connect a customer's organisation (OAuth 2.0, granular scopes) and send a quote to it
 * as a DRAFT quote. Nothing is ever sent to the end customer from here: they send it from Xero.
 */
import type { CustomerLine } from "@/lib/site/price";

export const XERO_SCOPES = [
  "openid", "profile", "email", "offline_access",
  "accounting.invoices",       // quotes live under invoices in Xero's granular scopes
  "accounting.contacts",       // find or add the customer
  "accounting.settings.read",  // organisation name
] as const;

const AUTH = "https://login.xero.com/identity/connect/authorize";
const TOKEN = "https://identity.xero.com/connect/token";
const API = "https://api.xero.com";

export type XeroConfig = { clientId: string; clientSecret: string; redirectUri: string };
export type XeroTokens = { access_token: string; refresh_token: string; expires_at: number; xero_tenant_id?: string; org_name?: string };

export function xeroConfigFromEnv(origin: string): XeroConfig | null {
  const clientId = process.env.XERO_CLIENT_ID;
  const clientSecret = process.env.XERO_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret, redirectUri: `${origin}/api/connect/xero/callback` };
}

export function xeroAuthorizeUrl(cfg: XeroConfig, state: string): string {
  const q = new URLSearchParams({ response_type: "code", client_id: cfg.clientId, redirect_uri: cfg.redirectUri, scope: XERO_SCOPES.join(" "), state });
  return `${AUTH}?${q.toString()}`;
}

async function tokenRequest(cfg: XeroConfig, body: Record<string, string>, f: typeof fetch, now: number): Promise<XeroTokens> {
  const res = await f(TOKEN, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString("base64")}`,
    },
    body: new URLSearchParams(body).toString(),
  });
  const data = (await res.json()) as { access_token?: string; refresh_token?: string; expires_in?: number; error?: string; error_description?: string };
  if (!res.ok || !data.access_token || !data.refresh_token) throw new Error(`Xero sign-in failed: ${data.error_description ?? data.error ?? res.status}`);
  // Xero rotates refresh tokens: the new one must be saved every time.
  return { access_token: data.access_token, refresh_token: data.refresh_token, expires_at: now + Math.max(0, (data.expires_in ?? 1800) - 60) * 1000 };
}

export function xeroExchangeCode(cfg: XeroConfig, code: string, f: typeof fetch = fetch, now = Date.now()) {
  return tokenRequest(cfg, { grant_type: "authorization_code", code, redirect_uri: cfg.redirectUri }, f, now);
}

export async function xeroValidToken(cfg: XeroConfig, t: XeroTokens, save: (t: XeroTokens) => Promise<void>, f: typeof fetch = fetch, now = Date.now()): Promise<XeroTokens> {
  if (t.expires_at > now) return t;
  const fresh = await tokenRequest(cfg, { grant_type: "refresh_token", refresh_token: t.refresh_token }, f, now);
  const merged = { ...fresh, xero_tenant_id: t.xero_tenant_id, org_name: t.org_name };
  await save(merged);
  return merged;
}

/** The organisation the user picked when approving (the first organisation connection). */
export async function xeroOrganisation(accessToken: string, f: typeof fetch = fetch): Promise<{ tenantId: string; name: string }> {
  const res = await f(`${API}/connections`, { headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" } });
  if (!res.ok) throw new Error(`Couldn't read your Xero organisations (${res.status}).`);
  const list = (await res.json()) as { tenantId: string; tenantName: string; tenantType: string; updatedDateUtc?: string }[];
  const orgs = list.filter((c) => c.tenantType === "ORGANISATION");
  // Newest first: when someone re-connects to pick another organisation, that one is used.
  orgs.sort((a, b) => String(b.updatedDateUtc ?? "").localeCompare(String(a.updatedDateUtc ?? "")));
  if (!orgs[0]) throw new Error("No Xero organisation was connected.");
  return { tenantId: orgs[0].tenantId, name: orgs[0].tenantName };
}

type XeroCall = (path: string, init?: { method?: string; body?: unknown }) => Promise<unknown>;

export function xeroClient(accessToken: string, xeroTenantId: string, f: typeof fetch = fetch): XeroCall {
  return async (path, init = {}) => {
    const res = await f(`${API}/api.xro/2.0${path}`, {
      method: init.method ?? "GET",
      headers: { Authorization: `Bearer ${accessToken}`, "xero-tenant-id": xeroTenantId, Accept: "application/json", ...(init.body ? { "Content-Type": "application/json" } : {}) },
      body: init.body ? JSON.stringify(init.body) : undefined,
    });
    const text = await res.text();
    const data = text ? JSON.parse(text) : {};
    if (!res.ok) {
      const d = data as { Message?: string; Elements?: { ValidationErrors?: { Message: string }[] }[]; Detail?: string; Title?: string };
      const why = d.Elements?.[0]?.ValidationErrors?.map((v) => v.Message).join("; ") || d.Message || d.Detail || d.Title || res.status;
      throw new Error(`Xero: ${why}`);
    }
    return data;
  };
}

/**
 * The Xero quote we made earlier, if it's still there to update. Returns null when it was deleted in Xero
 * or can't be found (for example after reconnecting to another organisation), so a fresh draft gets made.
 */
export async function liveXeroQuoteId(call: XeroCall, quoteId: string | null | undefined): Promise<string | null> {
  if (!quoteId) return null;
  try {
    const out = (await call(`/Quotes/${encodeURIComponent(quoteId)}`)) as { Quotes?: { QuoteID: string; Status?: string }[] };
    const q = out.Quotes?.[0];
    if (!q || q.Status === "DELETED") return null;
    return q.QuoteID;
  } catch {
    return null;
  }
}

/** Find the customer in Xero by name (or email), or add them. */
export async function findOrCreateContact(call: XeroCall, name: string, email: string | null): Promise<string> {
  const term = encodeURIComponent(name.trim());
  const found = (await call(`/Contacts?searchTerm=${term}&summaryOnly=true`)) as { Contacts?: { ContactID: string; Name: string; EmailAddress?: string }[] };
  const exact = found.Contacts?.find((c) => c.Name.trim().toLowerCase() === name.trim().toLowerCase())
    ?? (email ? found.Contacts?.find((c) => c.EmailAddress?.toLowerCase() === email.toLowerCase()) : undefined);
  if (exact) return exact.ContactID;
  const made = (await call("/Contacts", { method: "PUT", body: { Contacts: [{ Name: name.trim(), ...(email ? { EmailAddress: email } : {}) }] } })) as { Contacts: { ContactID: string }[] };
  return made.Contacts[0].ContactID;
}

const XERO_UNIT: Record<string, string> = { "m²": "m2", "m³": "m3" };

/** Our quote as a Xero DRAFT quote: amounts ex GST, GST on income, our number as the reference. */
export function buildXeroQuote(input: {
  contactId: string; quoteNo: string; title: string; siteAddress: string | null; terms: string;
  lines: CustomerLine[]; date: Date; existingQuoteId?: string | null;
}) {
  const day = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "Australia/Brisbane" });
  const expiry = new Date(input.date.getTime() + 30 * 24 * 3600 * 1000);
  return {
    Quotes: [{
      ...(input.existingQuoteId ? { QuoteID: input.existingQuoteId } : {}),
      Contact: { ContactID: input.contactId },
      Date: day(input.date),
      ExpiryDate: day(expiry),
      Status: "DRAFT",
      LineAmountTypes: "Exclusive",
      Reference: input.quoteNo,
      Title: input.title.slice(0, 100),
      Summary: xeroSummary(input).slice(0, 3000),
      Terms: input.terms.slice(0, 4000),
      LineItems: input.lines.map((l) => ({
        Description: `${l.description} (per ${XERO_UNIT[l.unit] ?? l.unit})`,
        Quantity: round(l.quantity, 4),
        // Unit price to 4 places so quantity x price lands on our line total.
        UnitAmount: l.quantity ? round(l.total / l.quantity, 4) : l.total,
        TaxType: "OUTPUT",
      })),
    }],
  };
}

/** What the job is, in a few lines: the site, then each item of work with its quantity. */
export function xeroSummary(input: { title: string; siteAddress: string | null; lines: CustomerLine[]; quoteNo: string }) {
  const out: string[] = [];
  const site = input.siteAddress?.trim();
  if (site) out.push(`Site: ${site}`);
  const work = input.lines.filter((l) => l.quantity > 0 && l.description.trim());
  if (work.length) {
    out.push("", "Scope of works:");
    for (const l of work) out.push(`- ${l.description.trim()} (${fmtQty(l.quantity)} ${l.unit})`);
  }
  out.push("", `Price valid for 30 days. Our ref ${input.quoteNo}.`);
  return out.join("\n").trim();
}

function fmtQty(n: number) {
  return n.toLocaleString("en-AU", { maximumFractionDigits: 2 });
}

function round(n: number, dp = 2) {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}
