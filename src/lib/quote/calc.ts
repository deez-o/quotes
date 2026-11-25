/**
 * The maths. Plain code, never the AI: tonnes, whole shifts, travel band,
 * crew rate and extra establishments. All inputs come from the customer's own
 * catalogue, rates and settings.
 */
import type { JobType, Operation } from "./schema";

export type Product = {
  code: string;
  name: string;
  operation: Operation;
  density_t_per_m3: number | null;
  active: boolean;
  aliases: string[];
};

export type Rate = { kind: string; key: string; value: number; unit: string };

export type TravelBand = "under_60min" | "over_60min" | "unknown";

/** Tonnes = m² × depth (m) × density (t/m³), to one decimal place. */
export function tonnes(areaM2: number, depthMm: number, densityTPerM3: number): number {
  if (areaM2 < 0 || depthMm < 0 || densityTPerM3 < 0) throw new Error("tonnes: negative input");
  return Math.round(areaM2 * (depthMm / 1000) * densityTPerM3 * 10) / 10;
}

/**
 * Whole shifts for an area at a production rate, allowing a leeway before a
 * shift is added (e.g. prime 8,000 m²/shift with 10% leeway: 8,800 m² is one shift).
 * Always at least one shift when there is any area.
 */
export function wholeShifts(areaM2: number, m2PerShift: number, leewayPercent = 0): number {
  if (areaM2 <= 0) return 0;
  if (m2PerShift <= 0) throw new Error("wholeShifts: production rate must be positive");
  const capacity = m2PerShift * (1 + leewayPercent / 100);
  // Small epsilon so 8,800 / 8,800 counts as exactly one shift despite float error.
  return Math.max(1, Math.ceil(areaM2 / capacity - 1e-9));
}

/** Travel band from one-way minutes (including any truck allowance). */
export function travelBand(oneWayMinutes: number | null | undefined): TravelBand {
  if (oneWayMinutes == null || !Number.isFinite(oneWayMinutes)) return "unknown";
  return oneWayMinutes > 60 ? "over_60min" : "under_60min";
}

/** Rate lookup by kind + key. */
export function findRate(rates: Rate[], kind: string, key: string): Rate | undefined {
  return rates.find((r) => r.kind === kind && r.key === key);
}

/**
 * Production rate key for a line. Spray and prime have their own rates;
 * asphalt uses the job type (e.g. production_subdivision).
 */
export function productionKey(jobType: JobType, operation: Operation): string {
  if (operation === "prime") return "production_prime";
  if (operation === "spray_seal" || operation === "primer_seal") return "production_spray";
  if (jobType === "carpark_bays_islands") return "production_carpark_islands";
  return `production_${jobType}`;
}

/**
 * Crew $/shift. Supports two shapes in the customer's rates:
 *  - banded:  key "crew:<job_type>:<min_m2>-<max_m2|up>:<under_60min|over_60min>"
 *             e.g. "crew:subdivision:3000-up:under_60min" = 13500
 *  - flat:    key "crew_under_60min" / "crew_over_60min"
 * Returns the matched key and value, or null when nothing fits (the job is flagged).
 */
export function crewRate(
  rates: Rate[],
  jobType: JobType,
  m2PerShift: number,
  band: TravelBand,
): { key: string; value: number } | null {
  const useBand = band === "unknown" ? "under_60min" : band;
  const banded = rates
    .filter((r) => r.kind === "crew" && r.key.startsWith(`crew:${jobType}:`) && r.key.endsWith(`:${useBand}`))
    .map((r) => {
      const range = r.key.split(":")[2] ?? "";
      const [lo, hi] = range.split("-");
      return { r, min: Number(lo), max: hi === "up" ? Infinity : Number(hi) };
    })
    .filter((b) => Number.isFinite(b.min));

  if (banded.length > 0) {
    const hit = banded.find((b) => m2PerShift > b.min && m2PerShift <= b.max)
      ?? banded.find((b) => m2PerShift >= b.min && m2PerShift <= b.max);
    if (hit) return { key: hit.r.key, value: hit.r.value };
    // Below the lowest band: use the lowest band.
    const lowest = [...banded].sort((a, b) => a.min - b.min)[0];
    if (m2PerShift <= lowest.min) return { key: lowest.r.key, value: lowest.r.value };
    return null;
  }

  const flat = findRate(rates, "crew", `crew_${useBand}`);
  return flat ? { key: flat.key, value: flat.value } : null;
}

/** Cost of establishments beyond those allowed. */
export function extraEstablishmentCost(count: number, allowed: number, ratePerExtra: number | null): number {
  if (ratePerExtra == null) return 0;
  return Math.max(0, count - allowed) * ratePerExtra;
}

/** Percentage difference between two quantities, relative to the reference (e.g. the BoQ). */
export function percentDifference(value: number, reference: number): number {
  if (reference === 0) return value === 0 ? 0 : 100;
  return Math.abs(value - reference) / Math.abs(reference) * 100;
}

/** Match what the customer wrote to a product: exact code, then name, then alias (case-insensitive). */
export function matchProduct(products: Product[], written: string): Product | undefined {
  const w = written.trim().toLowerCase();
  if (!w) return undefined;
  const active = products.filter((p) => p.active);
  return (
    active.find((p) => p.code.toLowerCase() === w) ??
    active.find((p) => p.name.toLowerCase() === w) ??
    active.find((p) => p.aliases.some((a) => a.toLowerCase() === w))
  );
}
