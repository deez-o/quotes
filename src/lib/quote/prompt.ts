/**
 * Builds the AI prompt for one RFQ.
 *
 * SYSTEM part is identical for every RFQ of a tenant (until its rules,
 * products, examples or settings change), so the provider's cached-input
 * price applies. USER part changes per RFQ.
 *
 * Only this tenant's data goes in. Never another tenant's rules or examples.
 */
import type { Product } from "./calc";
import { rulesBlock } from "@/lib/rules";

export const PROMPT_VERSION = "quote-v2";

export type PromptRule = { code: string; grp: string | null; text: string };
export type PromptExample = { title: string; rfq_text: string | null; approved_json: unknown };
export type PromptSettings = {
  default_binder: string | null;
  default_prime: string | null;
  spray_markup_percent: number | null;
  change_tolerance_percent: number;
  reuse_quote_numbers: boolean;
  pass_on_rules: string | null;
};

export type SystemPromptInput = {
  tradingName: string;
  /** House rules (hidden from the customer). */
  houseRules?: PromptRule[];
  /** The customer's own rules; these win over house rules. */
  rules: PromptRule[];
  products: Product[];
  settings: PromptSettings;
  examples: PromptExample[];
};

const MAX_EXAMPLE_CHARS = 6000;

export function buildSystemPrompt(input: SystemPromptInput): string {
  const { tradingName, rules, products, settings, examples } = input;

  const productLines = products
    .filter((p) => p.active)
    .map((p) => `${p.code} | ${p.name} | ${p.operation} | ${p.density_t_per_m3 ?? "-"} | ${p.aliases.join(", ") || "-"}`);

  const settingLines = [
    `Default binder: ${settings.default_binder ?? "not set (flag if needed)"}`,
    `Default prime: ${settings.default_prime ?? "not set (flag if needed)"}`,
    `Spray mark-up: ${settings.spray_markup_percent != null ? `${settings.spray_markup_percent}%` : "not set"}`,
    `Flag drawing vs RFQ differences over: ${settings.change_tolerance_percent}%`,
    `Reuse quote numbers for identical scope and quantities: ${settings.reuse_quote_numbers ? "yes" : "no, every quote gets a new number"}`,
    `Work passed to others (flag as pass_on, do not price): ${settings.pass_on_rules ?? "none set"}`,
  ];

  const exampleBlocks = examples.slice(0, 3).map((e, i) => {
    const json = JSON.stringify(e.approved_json ?? {});
    return [
      `### Example ${i + 1}: ${e.title}`,
      `RFQ: ${(e.rfq_text ?? "").slice(0, MAX_EXAMPLE_CHARS)}`,
      `Approved answer: ${json.slice(0, MAX_EXAMPLE_CHARS)}`,
    ].join("\n");
  });

  return [
    `# Role`,
    `You are the estimator's assistant at ${tradingName}. You read requests for quote and draft the scope for a person to check. You never send anything. You never set or calculate a price, total or contribution: write "calc in Excel". Every guess is a CHECK flag.`,
    ``,
    `# Rules`,
    rulesBlock(input.houseRules ?? [], rules),
    ``,
    `# Settings`,
    settingLines.join("\n"),
    ``,
    `# Product list (code | name | operation | density t/m3 | other names customers use)`,
    `Only use these codes. If nothing fits, product_code = null and check = true.`,
    productLines.join("\n"),
    ``,
    `# Worked examples from this company`,
    exampleBlocks.length ? exampleBlocks.join("\n\n") : "None yet.",
    ``,
    `# Output`,
    `Reply with JSON only, matching schema rfq_quote_answer v1.0. Quantities come from the RFQ (BoQ first). Code will recalculate tonnes, shifts and crew rates from the customer's figures, so report what the documents say and flag anything assumed.`,
  ].join("\n");
}

export type AttachmentSummary = { id: string; filename: string; kind_guess: string; pages: number | null; size_bytes: number | null };

export type RfqBundle = {
  email: { from: string; to: string; received_at: string; subject: string; body: string };
  thread_summary: string | null;
  attachments: AttachmentSummary[];
  /** Extracted text per attachment (BoQ tables as CSV), already capped. */
  extracted: { attachment_id: string; text: string; truncated: boolean }[];
  /** Drawing measure-up results from the take-off engine (code, not AI). */
  drawings: { attachment_id: string; page: number; title: string | null; scale: string | null; widths_m: number[]; notes: string | null }[];
  haul: { km: number | null; minutes: number | null; from: string | null };
  related_quotes: { quote_no: string; customer: string; site: string; summary: string }[];
};

const MAX_BODY = 20000;
const MAX_ATTACHMENT_TEXT = 30000;

export function buildUserMessage(b: RfqBundle): string {
  const body = b.email.body.length > MAX_BODY ? `${b.email.body.slice(0, MAX_BODY)}\n[email truncated]` : b.email.body;
  const parts = [
    `# Email`,
    `From: ${b.email.from}`,
    `To: ${b.email.to}`,
    `Received (AEST): ${b.email.received_at}`,
    `Subject: ${b.email.subject}`,
    ``,
    body,
    ``,
    `# Earlier in the thread`,
    b.thread_summary ?? "Nothing earlier.",
    ``,
    `# Attachments`,
    b.attachments.length
      ? b.attachments.map((a) => `${a.id} | ${a.filename} | ${a.kind_guess} | ${a.pages ?? "-"} pages | ${a.size_bytes ?? "-"} bytes`).join("\n")
      : "None.",
  ];

  for (const x of b.extracted) {
    const text = x.text.length > MAX_ATTACHMENT_TEXT ? x.text.slice(0, MAX_ATTACHMENT_TEXT) : x.text;
    const cut = x.truncated || x.text.length > MAX_ATTACHMENT_TEXT;
    parts.push(``, `## Text of ${x.attachment_id}${cut ? " (truncated)" : ""}`, text);
  }

  parts.push(``, `# Drawing measure-up (from code; widths are approximate)`);
  parts.push(
    b.drawings.length
      ? b.drawings
          .map((d) => `${d.attachment_id} p${d.page} | ${d.title ?? "untitled"} | scale ${d.scale ?? "not found"} | widths ${d.widths_m.length ? d.widths_m.map((w) => `${w} m`).join(", ") : "-"}${d.notes ? ` | ${d.notes}` : ""}`)
          .join("\n")
      : "No drawings measured.",
  );

  parts.push(
    ``,
    `# Haul (from code)`,
    b.haul.km != null ? `${b.haul.km} km, ${b.haul.minutes} min one way from ${b.haul.from ?? "the depot"}` : "Not calculated.",
    ``,
    `# Related past quotes`,
    b.related_quotes.length
      ? b.related_quotes.map((q) => `${q.quote_no} | ${q.customer} | ${q.site} | ${q.summary}`).join("\n")
      : "None found.",
  );

  return parts.join("\n");
}
