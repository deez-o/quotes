import type { QuoteAnswer } from "@/lib/quote/schema";

/** A clean answer for a demo carpark RFQ (Bayside Developments, made up). */
export function carparkAnswer(): QuoteAnswer {
  return {
    schema_version: "1.0",
    classification: { type: "rfq_new", related_quote_no: null, reason: "Request to price asphalt to a carpark." },
    job: { short_name: "Old Cleveland Rd carpark", job_type: "carpark_bays_islands", day_or_night: "day", is_eci_or_budget: false },
    customer: {
      name_as_written: "Bayside Developments", matched_account_id: null,
      contact_name: "Sam Turner", contact_email: "sam@baysidedev.example", contact_phone: null,
    },
    site: {
      address: "22 Old Cleveland Rd", suburb: "Capalaba", state: "QLD", postcode: "4157",
      address_source: "RFQ email", address_assumed: false,
    },
    dates: { due: "2026-11-28", works_start: null },
    documents: [{ attachment_id: "a1", kind: "boq", folder: "2. BOQ", read: true }],
    takeoff_requests: [],
    scope: [
      {
        line_ref: "1", description_as_written: "AC 10 mix wearing course 40mm", product_code: "AC10", product_name: "AC10 dense 10 mm",
        operation: "asphalt", depth_mm: 40, area_m2: 1850, tonnes: 177.6, quantity_source: "boq", assumption: null, check: false,
      },
      {
        line_ref: "2", description_as_written: "sealer to base", product_code: "PRIME", product_name: "Prime",
        operation: "prime", depth_mm: null, area_m2: 1850, tonnes: null, quantity_source: "boq",
        assumption: "Plain 'sealer' read as prime (R19).", check: true,
      },
    ],
    not_ours: ["Line marking and wheel stops (by others, email line 4)"],
    shifts: [
      { line_ref: "1", shifts: 3, m2_per_shift: 900, rule_applied: "Carpark with islands production rate" },
      { line_ref: "2", shifts: 1, m2_per_shift: 8000, rule_applied: "Prime rate" },
    ],
    establishments: { count: 2, reason: "Prime visit, then asphalt visit." },
    crew: { rate_key: "crew_under_60min", travel_band: "under_60min", reason: "42 minutes from depot." },
    flags: [
      { rank: 1, severity: "QUESTION_FOR_CLIENT", text: "Day or night works? The RFQ does not say.", source: "Email" },
    ],
    comparables: [],
    overview: { headline: "Bayside Developments: carpark, Capalaba", summary_line: "1,850 m² AC10 40 mm on prime, 2 establishments." },
    confidence: { overall: "medium", lowest_field: "operation of line 2", why: "Sealer type not stated." },
  };
}
