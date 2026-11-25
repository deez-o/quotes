/**
 * rfq_quote_answer v1.0: the one structured answer the AI returns per RFQ.
 * Sent to the model as `response_format: json_schema` with `strict: true`.
 * Code still validates every answer (see validate.ts).
 */

const nullableString = { type: ["string", "null"] } as const;
const nullableNumber = { type: ["number", "null"] } as const;

export const RFQ_QUOTE_ANSWER_SCHEMA = {
  name: "rfq_quote_answer",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: [
      "schema_version", "classification", "job", "customer", "site", "dates", "documents",
      "takeoff_requests", "scope", "not_ours", "shifts", "establishments", "crew", "flags",
      "comparables", "overview", "confidence",
    ],
    properties: {
      schema_version: { type: "string", enum: ["1.0"] },
      classification: {
        type: "object", additionalProperties: false, required: ["type", "related_quote_no", "reason"],
        properties: {
          type: { enum: ["rfq_new", "rfq_revision", "rfq_clarification", "not_rfq", "awarded", "lost", "pass_on"] },
          related_quote_no: nullableString,
          reason: { type: "string" },
        },
      },
      job: {
        type: "object", additionalProperties: false, required: ["short_name", "job_type", "day_or_night", "is_eci_or_budget"],
        properties: {
          short_name: { type: "string" },
          job_type: { enum: ["subdivision", "carpark_bays_islands", "open_carpark", "road", "patching", "other"] },
          day_or_night: { enum: ["day", "night", "unknown"] },
          is_eci_or_budget: { type: "boolean" },
        },
      },
      customer: {
        type: "object", additionalProperties: false,
        required: ["name_as_written", "matched_account_id", "contact_name", "contact_email", "contact_phone"],
        properties: {
          name_as_written: { type: "string" },
          matched_account_id: nullableString,
          contact_name: nullableString,
          contact_email: nullableString,
          contact_phone: nullableString,
        },
      },
      site: {
        type: "object", additionalProperties: false,
        required: ["address", "suburb", "state", "postcode", "address_source", "address_assumed"],
        properties: {
          address: nullableString, suburb: nullableString, state: nullableString, postcode: nullableString,
          address_source: { type: "string" },
          address_assumed: { type: "boolean" },
        },
      },
      dates: {
        type: "object", additionalProperties: false, required: ["due", "works_start"],
        properties: { due: nullableString, works_start: nullableString },
      },
      documents: {
        type: "array",
        items: {
          type: "object", additionalProperties: false, required: ["attachment_id", "kind", "folder", "read"],
          properties: {
            attachment_id: { type: "string" },
            kind: { enum: ["boq", "drawing", "spec", "rfq_letter", "photo", "signature", "other"] },
            folder: { enum: ["1. RFQ-Specs", "2. BOQ", "3. Drawings", "4. Correspondence", "5. Pricing", "skip"] },
            read: { type: "boolean" },
          },
        },
      },
      takeoff_requests: {
        type: "array",
        items: {
          type: "object", additionalProperties: false, required: ["attachment_id", "page", "layer_hint", "why"],
          properties: {
            attachment_id: { type: "string" }, page: { type: "integer" },
            layer_hint: { type: "string" }, why: { type: "string" },
          },
        },
      },
      scope: {
        type: "array",
        items: {
          type: "object", additionalProperties: false,
          required: ["line_ref", "description_as_written", "product_code", "product_name", "operation",
            "depth_mm", "area_m2", "tonnes", "quantity_source", "assumption", "check"],
          properties: {
            line_ref: { type: "string" },
            description_as_written: { type: "string" },
            product_code: nullableString,
            product_name: nullableString,
            operation: { enum: ["asphalt", "prime", "primer_seal", "spray_seal", "tack", "profiling", "other"] },
            depth_mm: nullableNumber,
            area_m2: nullableNumber,
            tonnes: nullableNumber,
            quantity_source: { enum: ["boq", "email", "takeoff", "assumed", "none"] },
            assumption: nullableString,
            check: { type: "boolean" },
          },
        },
      },
      not_ours: { type: "array", items: { type: "string" } },
      shifts: {
        type: "array",
        items: {
          type: "object", additionalProperties: false, required: ["line_ref", "shifts", "m2_per_shift", "rule_applied"],
          properties: {
            line_ref: { type: "string" }, shifts: { type: "integer" },
            m2_per_shift: { type: "number" }, rule_applied: { type: "string" },
          },
        },
      },
      establishments: {
        type: "object", additionalProperties: false, required: ["count", "reason"],
        properties: { count: { type: "integer" }, reason: { type: "string" } },
      },
      crew: {
        type: "object", additionalProperties: false, required: ["rate_key", "travel_band", "reason"],
        properties: {
          rate_key: { type: "string" },
          travel_band: { enum: ["under_60min", "over_60min", "unknown"] },
          reason: { type: "string" },
        },
      },
      flags: {
        type: "array",
        items: {
          type: "object", additionalProperties: false, required: ["rank", "severity", "text", "source"],
          properties: {
            rank: { type: "integer" },
            severity: { enum: ["CHECK", "INFO", "QUESTION_FOR_CLIENT"] },
            text: { type: "string" },
            source: { type: "string" },
          },
        },
      },
      comparables: {
        type: "array",
        items: {
          type: "object", additionalProperties: false, required: ["quote_no", "why_similar"],
          properties: { quote_no: { type: "string" }, why_similar: { type: "string" } },
        },
      },
      overview: {
        type: "object", additionalProperties: false, required: ["headline", "summary_line"],
        properties: { headline: { type: "string" }, summary_line: { type: "string" } },
      },
      confidence: {
        type: "object", additionalProperties: false, required: ["overall", "lowest_field", "why"],
        properties: {
          overall: { enum: ["high", "medium", "low"] },
          lowest_field: { type: "string" },
          why: { type: "string" },
        },
      },
    },
  },
} as const;

// TypeScript shape of a valid answer.
export type Operation = "asphalt" | "prime" | "primer_seal" | "spray_seal" | "tack" | "profiling" | "other";
export type JobType = "subdivision" | "carpark_bays_islands" | "open_carpark" | "road" | "patching" | "other";

export type ScopeLine = {
  line_ref: string;
  description_as_written: string;
  product_code: string | null;
  product_name: string | null;
  operation: Operation;
  depth_mm: number | null;
  area_m2: number | null;
  tonnes: number | null;
  quantity_source: "boq" | "email" | "takeoff" | "assumed" | "none";
  assumption: string | null;
  check: boolean;
};

export type Flag = { rank: number; severity: "CHECK" | "INFO" | "QUESTION_FOR_CLIENT"; text: string; source: string };

export type QuoteAnswer = {
  schema_version: "1.0";
  classification: {
    type: "rfq_new" | "rfq_revision" | "rfq_clarification" | "not_rfq" | "awarded" | "lost" | "pass_on";
    related_quote_no: string | null;
    reason: string;
  };
  job: { short_name: string; job_type: JobType; day_or_night: "day" | "night" | "unknown"; is_eci_or_budget: boolean };
  customer: {
    name_as_written: string; matched_account_id: string | null;
    contact_name: string | null; contact_email: string | null; contact_phone: string | null;
  };
  site: {
    address: string | null; suburb: string | null; state: string | null; postcode: string | null;
    address_source: string; address_assumed: boolean;
  };
  dates: { due: string | null; works_start: string | null };
  documents: { attachment_id: string; kind: string; folder: string; read: boolean }[];
  takeoff_requests: { attachment_id: string; page: number; layer_hint: string; why: string }[];
  scope: ScopeLine[];
  not_ours: string[];
  shifts: { line_ref: string; shifts: number; m2_per_shift: number; rule_applied: string }[];
  establishments: { count: number; reason: string };
  crew: { rate_key: string; travel_band: "under_60min" | "over_60min" | "unknown"; reason: string };
  flags: Flag[];
  comparables: { quote_no: string; why_similar: string }[];
  overview: { headline: string; summary_line: string };
  confidence: { overall: "high" | "medium" | "low"; lowest_field: string; why: string };
};
