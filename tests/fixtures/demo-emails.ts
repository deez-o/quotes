/**
 * Demo inbox: made-up emails to Demo Asphalt Co. No real customers.
 * Shaped like what the Microsoft Graph adapter produces (see src/lib/mail/types.ts).
 */
import type { IncomingMessage } from "@/lib/mail/types";

const at = (name: string, contentType: string, size: number, sha256: string, isInline = false) =>
  ({ id: `${name}-id`, name, contentType, size, sha256, isInline });

const logo = at("image001.png", "image/png", 6_200, "sig-logo-hash", true);

export type DemoEmail = IncomingMessage & {
  expect: {
    category: "rfq" | "award" | "invoice" | "general" | "junk";
    link: "new_job" | "attach_to_job" | "duplicate" | "no_job";
    note?: string;
  };
};

export const demoEmails: DemoEmail[] = [
  {
    id: "m01", conversationId: "c-bayside-carpark", from: "sam@baysidedev.example", to: "sales@demoasphalt.example",
    subject: "RFQ - Carpark resurfacing, 22 Old Cleveland Rd Capalaba", receivedAt: "2026-11-26T08:12:00+10:00",
    bodyText: "Hi team,\nPlease provide a quote for asphalt to the carpark at 22 Old Cleveland Rd, Capalaba. BoQ attached. Sealer to base, 40mm AC 10 mix wearing course. Line marking and wheel stops by others.\nQuotes due Friday 28 Nov.\nRegards, Sam Turner\nBayside Developments",
    attachments: [at("BoQ - Carpark.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", 18_400, "boq-bayside"), logo],
    expect: { category: "rfq", link: "new_job" },
  },
  {
    id: "m02", conversationId: "c-northpoint-stage3", from: "estimating@northpointcivil.example", to: "sales@demoasphalt.example",
    subject: "Request for quotation: Stage 3 subdivision, Narangba", receivedAt: "2026-11-26T09:40:00+10:00",
    bodyText: "Good morning,\nWe invite you to submit pricing for the asphalt works to Stage 3 (roads 1-4). Drawings and specification attached. Tender closes 3 December.\nThanks,\nPriya, Northpoint Civil",
    attachments: [
      at("C-101 Roadworks layout.pdf", "application/pdf", 2_400_000, "dwg-np-101"),
      at("C-201 Typical sections.pdf", "application/pdf", 900_000, "dwg-np-201"),
      at("Specification.pdf", "application/pdf", 1_200_000, "spec-np"),
    ],
    expect: { category: "rfq", link: "new_job" },
  },
  {
    id: "m03", conversationId: "c-northpoint-stage3-dup", from: "estimating@northpointcivil.example", to: "sales@demoasphalt.example",
    subject: "Request for quotation: Stage 3 subdivision, Narangba", receivedAt: "2026-11-26T09:44:00+10:00",
    bodyText: "Good morning,\nWe invite you to submit pricing for the asphalt works to Stage 3 (roads 1-4). Drawings and specification attached. Tender closes 3 December.\nThanks,\nPriya, Northpoint Civil",
    attachments: [
      at("C-101 Roadworks layout.pdf", "application/pdf", 2_400_000, "dwg-np-101"),
      at("C-201 Typical sections.pdf", "application/pdf", 900_000, "dwg-np-201"),
      at("Specification.pdf", "application/pdf", 1_200_000, "spec-np"),
    ],
    expect: { category: "rfq", link: "duplicate", note: "Same email sent twice, 4 minutes apart, new conversation." },
  },
  {
    id: "m04", conversationId: "c-bayside-carpark", from: "sam@baysidedev.example", to: "sales@demoasphalt.example",
    subject: "RE: RFQ - Carpark resurfacing, 22 Old Cleveland Rd Capalaba", receivedAt: "2026-11-26T14:05:00+10:00",
    bodyText: "Hi again, small change: the area is now 2,050 m2 as we've added the overflow bays. Revised BoQ attached.\nSam",
    attachments: [at("BoQ - Carpark rev B.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", 18_900, "boq-bayside-b")],
    expect: { category: "rfq", link: "attach_to_job", note: "Revision on the same thread overrides the earlier quantity." },
  },
  {
    id: "m05", conversationId: "c-ridgeline-seal", from: "tenders@ridgeline.example", to: "sales@demoasphalt.example",
    subject: "Pricing please - spray seal Mount Cotton Rd", receivedAt: "2026-11-26T10:15:00+10:00",
    bodyText: "Can you price a two coat C170 seal, 6,400 m2, Mount Cotton Rd shoulder widening. Prime included. Night works.\nCheers, Ridgeline Civil",
    attachments: [],
    expect: { category: "rfq", link: "new_job" },
  },
  {
    id: "m06", conversationId: "c-winslow-pictures", from: "ana@coastalcivil.example", to: "sales@demoasphalt.example",
    subject: "RFQ Ferry Road Ripley", receivedAt: "2026-11-26T11:02:00+10:00",
    bodyText: "Hi,\nPlease quote the following.\n1. Scope = asphalt and prime to Ferry Road and cycle path\n2. Areas =\n\n3. Programme = early 2027\nThanks Ana",
    attachments: [at("image002.png", "image/png", 148_000, "areas-table-picture", true), logo],
    expect: { category: "rfq", link: "new_job", note: "Quantities only in an embedded picture: must be read, not asked for." },
  },
  {
    id: "m07", conversationId: "c-estimateone", from: "noreply@estimateone.example", to: "sales@demoasphalt.example",
    subject: "You're invited to tender: Kingsford Shopping Centre carpark", receivedAt: "2026-11-26T07:30:00+10:00",
    bodyText: "Builder X has invited you to quote on Kingsford Shopping Centre carpark. View documents: https://app.estimateone.example/tender/12345/documents\nDecline to quote: https://app.estimateone.example/tender/12345/decline",
    attachments: [],
    expect: { category: "rfq", link: "new_job", note: "Portal invite: follow the documents link, never the decline link." },
  },
  {
    id: "m08", conversationId: "c-driveway", from: "homeowner.jane@mail.example", to: "sales@demoasphalt.example",
    subject: "Quote for my driveway", receivedAt: "2026-11-26T12:20:00+10:00",
    bodyText: "Hello, could I get a quote to asphalt my home driveway, about 60 m2? Thanks Jane",
    attachments: [],
    expect: { category: "rfq", link: "new_job", note: "Residential driveway: pass-on under the customer's setting, not priced." },
  },
  {
    id: "m09", conversationId: "c-award", from: "sam@baysidedev.example", to: "sales@demoasphalt.example",
    subject: "Successful tender - Q-0001 Carpark Capalaba", receivedAt: "2026-12-02T09:00:00+10:00",
    bodyText: "Hi team, pleased to advise you have been awarded the carpark works under quote Q-0001. Purchase order to follow.\nSam",
    attachments: [],
    expect: { category: "award", link: "no_job" },
  },
  {
    id: "m10", conversationId: "c-invoice", from: "accounts@quarrysupplies.example", to: "sales@demoasphalt.example",
    subject: "Tax Invoice INV-88231", receivedAt: "2026-11-26T15:00:00+10:00",
    bodyText: "Please find attached tax invoice INV-88231 for aggregate supplied. Amount due $4,812.50 by 20 Dec.",
    attachments: [at("INV-88231.pdf", "application/pdf", 88_000, "inv-88231")],
    expect: { category: "invoice", link: "no_job" },
  },
  {
    id: "m11", conversationId: "c-newsletter", from: "news@industrymag.example", to: "sales@demoasphalt.example",
    subject: "This week in roads: 5 trends for 2027", receivedAt: "2026-11-26T06:00:00+10:00",
    bodyText: "Read our latest newsletter. Unsubscribe at any time.",
    attachments: [],
    expect: { category: "junk", link: "no_job" },
  },
  {
    id: "m12", conversationId: "c-general", from: "ops@demoasphalt.example", to: "sales@demoasphalt.example",
    subject: "Crew roster next week", receivedAt: "2026-11-26T16:30:00+10:00",
    bodyText: "FYI roster attached for next week. No changes to Monday.",
    attachments: [at("Roster.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", 12_000, "roster")],
    expect: { category: "general", link: "no_job" },
  },
];
