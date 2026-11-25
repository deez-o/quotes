/** Demo Asphalt Co, as in supabase/seed.sql. All figures are made up. */
import type { Product, Rate } from "@/lib/quote/calc";
import type { TenantQuoteContext } from "@/lib/quote/validate";
import type { PromptRule, PromptSettings } from "@/lib/quote/prompt";

export const demoProducts: Product[] = [
  { code: "AC10", name: "AC10 dense 10 mm", operation: "asphalt", density_t_per_m3: 2.4, active: true, aliases: ["AC 10 mix", "10mm asphalt"] },
  { code: "AC14", name: "AC14 dense 14 mm", operation: "asphalt", density_t_per_m3: 2.4, active: true, aliases: ["AC15", "hot mix", "14mm asphalt"] },
  { code: "AC20", name: "AC20 dense 20 mm", operation: "asphalt", density_t_per_m3: 2.4, active: true, aliases: ["20mm asphalt", "base course"] },
  { code: "PRIME", name: "Prime", operation: "prime", density_t_per_m3: null, active: true, aliases: ["sealer", "prime coat"] },
  { code: "PSEAL", name: "Primer seal 7 mm", operation: "primer_seal", density_t_per_m3: null, active: true, aliases: ["primerseal"] },
  { code: "C170", name: "Spray seal C170 14/7", operation: "spray_seal", density_t_per_m3: null, active: true, aliases: ["C170 seal", "two coat seal"] },
  { code: "TACK", name: "Tack coat", operation: "tack", density_t_per_m3: null, active: true, aliases: ["bond coat"] },
  { code: "OLD1", name: "Discontinued mix", operation: "asphalt", density_t_per_m3: 2.3, active: false, aliases: [] },
];

export const demoRates: Rate[] = [
  { kind: "crew", key: "crew_under_60min", value: 1000, unit: "AUD/shift" },
  { kind: "crew", key: "crew_over_60min", value: 1200, unit: "AUD/shift" },
  { kind: "production", key: "production_open_carpark", value: 1500, unit: "m2/shift" },
  { kind: "production", key: "production_carpark_islands", value: 900, unit: "m2/shift" },
  { kind: "production", key: "production_road", value: 2000, unit: "m2/shift" },
  { kind: "production", key: "production_subdivision", value: 1800, unit: "m2/shift" },
  { kind: "production", key: "production_prime", value: 8000, unit: "m2/shift" },
  { kind: "production", key: "production_spray", value: 5000, unit: "m2/shift" },
];

/** A banded crew table in the format calc.crewRate reads (demo numbers). */
export const demoBandedCrew: Rate[] = [
  { kind: "crew", key: "crew:subdivision:3000-up:under_60min", value: 900, unit: "AUD/shift" },
  { kind: "crew", key: "crew:subdivision:3000-up:over_60min", value: 1100, unit: "AUD/shift" },
  { kind: "crew", key: "crew:subdivision:1000-3000:under_60min", value: 800, unit: "AUD/shift" },
  { kind: "crew", key: "crew:subdivision:1000-3000:over_60min", value: 1000, unit: "AUD/shift" },
  { kind: "crew", key: "crew:subdivision:0-1000:under_60min", value: 700, unit: "AUD/shift" },
  { kind: "crew", key: "crew:subdivision:0-1000:over_60min", value: 900, unit: "AUD/shift" },
];

export const demoSettings: PromptSettings = {
  default_binder: "C320",
  default_prime: "PRIME",
  spray_markup_percent: 10,
  change_tolerance_percent: 5,
  reuse_quote_numbers: false,
  pass_on_rules: "Residential driveways go to our driveway partner.",
};

export const demoContext = (overrides: Partial<TenantQuoteContext> = {}): TenantQuoteContext => ({
  products: demoProducts,
  rates: demoRates,
  settings: { extra_establishment_rate: 2500, change_tolerance_percent: 5 },
  haulMinutes: 42,
  allowedEstablishments: 2,
  primeLeewayPercent: 10,
  ...overrides,
});

export const demoRules: PromptRule[] = [
  { code: "R1", grp: "Reading the RFQ", text: "Read the full email, every attachment and every embedded image before measuring or asking anything." },
  { code: "R16", grp: "Mixes and binders", text: "If no binder is stated, assume the customer's default binder and do not ask." },
  { code: "R36", grp: "Email and records", text: "Never send a quote. Drafts only." },
];
