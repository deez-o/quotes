/**
 * Tender portal invitations (EstimateOne, Tenderlink, BuildingConnected, Procore, Aconex...).
 * The email has no drawings: they're behind a link. We find the portal, the builder inviting,
 * their contact, the due date and the documents link, so the estimator can get the documents
 * and drop them into the quote. quoteout never opens the portal or answers it for them.
 */

export type PortalInvite = {
  portal: string;
  docsUrl: string | null;
  builder: string | null;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  project: string | null;
  due: string | null;
};

const PORTALS: { name: string; host: RegExp; from?: RegExp }[] = [
  { name: "EstimateOne", host: /(?:^|\.)estimateone\.com$/i },
  { name: "Tenderlink", host: /(?:^|\.)tenderlink\.com$/i },
  { name: "BuildingConnected", host: /(?:^|\.)buildingconnected\.com$/i },
  { name: "Procore", host: /(?:^|\.)procore\.com$/i },
  { name: "Aconex", host: /(?:^|\.)aconex\.com$/i },
  { name: "Tendersearch", host: /(?:^|\.)tendersearch\.com\.au$/i },
  { name: "QTenders", host: /(?:^|\.)qtenders\.epw\.qld\.gov\.au$/i },
  { name: "VendorPanel", host: /(?:^|\.)vendorpanel\.com\.au$/i },
  { name: "TenderSearch", host: /(?:^|\.)tenders\.net$/i },
];

/** Outlook "Safe Links" and similar wrappers -> the real address. */
export function unwrapLink(url: string): string {
  try {
    const u = new URL(url);
    if (/safelinks\.protection\.outlook\.com$/i.test(u.hostname) || /urldefense|mimecast|proofpoint/i.test(u.hostname)) {
      const inner = u.searchParams.get("url") ?? u.searchParams.get("u");
      if (inner) return decodeURIComponent(inner);
    }
    return url;
  } catch {
    return url;
  }
}

function links(text: string): string[] {
  return [...text.matchAll(/https?:\/\/[^\s<>"')\]]+/g)].map((m) => unwrapLink(m[0].replace(/[.,;]+$/, "")));
}

const hostOf = (u: string) => { try { return new URL(u).hostname; } catch { return ""; } };

export function detectPortal(body: string, from?: string | null): PortalInvite | null {
  const all = links(body);
  const fromHost = from ? (/@([\w.-]+)/.exec(from)?.[1] ?? "") : "";
  const hit = PORTALS.find((p) => p.host.test(fromHost) || all.some((l) => p.host.test(hostOf(l))));
  if (!hit) return null;
  // Not every email mentioning a portal is an invitation: look for invite words.
  if (!/invit|tender|quote|pricing|package|rfq|request for/i.test(body)) return null;

  const portalLinks = all.filter((l) => hit.host.test(hostOf(l)));
  // The documents link: not the respond buttons (quoting / not quoting / already have docs) or unsubscribe.
  const docs = portalLinks.find((l) => !/[?&]d=(?:already|quoting|declined)|unsub|requestDetailsUpdate|utm_/i.test(l)) ?? null;

  const line = (re: RegExp) => re.exec(body)?.[1]?.replace(/\s+/g, " ").trim() || null;
  const builder = line(/^\s*([A-Z][\w&.,' -]{2,80}?) (?:has invited you|is inviting)/m);
  const project = line(/(?:invited you to tender|tender)[:\s]*\n+\s*(.{5,160}?)\s*(?:\(Project #\d+\))?\s*$/im)
    ?? line(/package for (.{5,160}?)\.\s*$/im);
  const due = line(/(?:quote for this package is due|due(?: date)?|closes?|closing)[:\s]+((?:mon|tue|wed|thu|fri|sat|sun)?[\w ,/]{4,30}\d{4})/i);
  const emails = [...body.matchAll(/[\w.+'-]+@[\w-]+(?:\.[\w-]+)+/g)].map((m) => m[0].toLowerCase())
    .filter((e) => !PORTALS.some((p) => p.host.test(e.split("@")[1])) && !/noreply|no-reply|docs@/.test(e));
  // The person signing off: the last email address in the body that isn't ours or the portal's.
  const contactEmail = emails.length ? emails[emails.length - 1] : null;
  const contactName = contactEmail ? line(new RegExp(`\\n\\s*([A-Z][a-z]+(?: [A-Z][a-z'-]+){1,2})\\s*\\n\\s*${contactEmail.replace(/[.+]/g, "\\$&")}`, "i")) : null;
  const contactPhone = line(/\n\s*((?:\+?61 ?|0)[2-478](?:[ -]?\d){8})\s*(?:\n|$)/);

  return { portal: hit.name, docsUrl: docs, builder, contactName, contactEmail, contactPhone, project, due };
}
