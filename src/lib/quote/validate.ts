/**
 * Checks on every AI answer, then the code-side finishing (tonnes, shifts,
 * crew rate, flags). Errors go back to the AI once for a targeted retry;
 * if they persist, the job is labelled Needs Attention.
 */
import {
  crewRate, extraEstablishmentCost, findRate, percentDifference, productionKey, tonnes,
  travelBand, wholeShifts, type Product, type Rate,
} from "./calc";
import type { Flag, QuoteAnswer } from "./schema";

export type TenantQuoteContext = {
  products: Product[];
  rates: Rate[];
  settings: {
    extra_establishment_rate: number | null;
    change_tolerance_percent: number;
  };
  /** One-way haul minutes from the depot, computed by code (routing), not the AI. */
  haulMinutes: number | null;
  /** Establishments included before extras are charged. */
  allowedEstablishments: number;
  /** Prime leeway before adding a shift (%). */
  primeLeewayPercent: number;
};

export type Validation = { errors: string[]; warnings: string[] };

const PRICED_SOURCES = new Set(["boq", "email", "takeoff"]);

/** Structural and business checks. Errors are phrased so they can be sent back to the AI as-is. */
export function validateAnswer(answer: QuoteAnswer, ctx: TenantQuoteContext): Validation {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (answer.schema_version !== "1.0") errors.push(`schema_version must be "1.0".`);

  const isQuoteLike = ["rfq_new", "rfq_revision", "rfq_clarification"].includes(answer.classification.type);
  if (isQuoteLike && answer.scope.length === 0) {
    errors.push("Classification is an RFQ but scope is empty. List each scope line, or reclassify.");
  }

  const refs = new Set<string>();
  for (const line of answer.scope) {
    const where = `Scope line ${line.line_ref}`;
    if (refs.has(line.line_ref)) errors.push(`${where}: line_ref is used twice.`);
    refs.add(line.line_ref);

    if (line.product_code !== null) {
      const product = ctx.products.find((p) => p.code === line.product_code);
      if (!product) {
        errors.push(`${where}: product ${line.product_code} is not in the product list. Use a listed code, or null with check=true.`);
      } else if (!product.active) {
        errors.push(`${where}: product ${line.product_code} is inactive. Use an active code, or null with check=true.`);
      }
    } else if (!line.check) {
      errors.push(`${where}: product_code is null, so check must be true.`);
    }

    if (line.assumption && !line.check) errors.push(`${where}: has an assumption, so check must be true.`);

    if (PRICED_SOURCES.has(line.quantity_source) && !(line.area_m2 && line.area_m2 > 0)) {
      errors.push(`${where}: quantity_source is ${line.quantity_source} but area_m2 is missing or zero.`);
    }

    if (line.operation === "asphalt" && line.area_m2 && line.depth_mm == null && !line.check) {
      errors.push(`${where}: asphalt line needs depth_mm, or check=true with an assumption.`);
    }
  }

  for (const s of answer.shifts) {
    if (!refs.has(s.line_ref)) errors.push(`Shifts refer to line ${s.line_ref}, which is not in scope.`);
    if (s.shifts < 0) errors.push(`Shifts for line ${s.line_ref} cannot be negative.`);
  }

  for (const [label, value] of [["due", answer.dates.due], ["works_start", answer.dates.works_start]] as const) {
    if (value && Number.isNaN(Date.parse(value))) errors.push(`dates.${label} "${value}" is not a real date (use YYYY-MM-DD).`);
  }

  if (answer.establishments.count < 0) errors.push("establishments.count cannot be negative.");

  if (answer.confidence.overall === "high" && answer.scope.some((l) => l.check)) {
    warnings.push("Confidence is high although some lines need checking.");
  }

  return { errors, warnings };
}

export type FinishedLine = QuoteAnswer["scope"][number] & {
  tonnes_calc: number | null;
  shifts_calc: number | null;
  m2_per_shift_rate: number | null;
};

export type Finished = {
  answer: QuoteAnswer;
  lines: FinishedLine[];
  crew: { key: string; value: number } | null;
  travel_band: ReturnType<typeof travelBand>;
  extra_establishment_cost: number;
  flags: Flag[];
};

/**
 * Code decides the numbers: tonnes from the product density, whole shifts from
 * production rates, the crew rate from the customer's table. Differences from
 * what the AI wrote become flags. Every check=true line gets a CHECK flag.
 */
export function finishAnswer(answer: QuoteAnswer, ctx: TenantQuoteContext): Finished {
  const flags: Flag[] = answer.flags.map((f) => ({ ...f }));
  const addFlag = (severity: Flag["severity"], text: string, source: string) => {
    if (!flags.some((f) => f.text === text)) flags.push({ rank: 0, severity, text, source });
  };

  const lines: FinishedLine[] = answer.scope.map((line) => {
    const product = line.product_code ? ctx.products.find((p) => p.code === line.product_code) : undefined;

    let tonnesCalc: number | null = null;
    if (line.operation === "asphalt" && line.area_m2 && line.depth_mm && product?.density_t_per_m3) {
      tonnesCalc = tonnes(line.area_m2, line.depth_mm, product.density_t_per_m3);
      if (line.tonnes != null && percentDifference(line.tonnes, tonnesCalc) > 2) {
        addFlag("INFO", `Line ${line.line_ref}: tonnes recalculated to ${tonnesCalc} t (AI wrote ${line.tonnes} t).`, "Code: m² × depth × density");
      }
    } else if (line.operation === "asphalt" && line.area_m2 && line.depth_mm && product && !product.density_t_per_m3) {
      addFlag("CHECK", `Line ${line.line_ref}: no density for ${product.code}, tonnes not calculated.`, "Product list");
    }

    const rateKey = productionKey(answer.job.job_type, line.operation);
    const rate = findRate(ctx.rates, "production", rateKey);
    let shiftsCalc: number | null = null;
    if (line.area_m2 && rate) {
      const leeway = line.operation === "prime" ? ctx.primeLeewayPercent : 0;
      shiftsCalc = wholeShifts(line.area_m2, rate.value, leeway);
      const ai = answer.shifts.find((s) => s.line_ref === line.line_ref);
      if (ai && ai.shifts !== shiftsCalc) {
        addFlag("CHECK", `Line ${line.line_ref}: production rate gives ${shiftsCalc} shift(s); draft says ${ai.shifts}. Confirm (borderline jobs may be priced at the competitive count).`, `Rate ${rateKey}`);
      }
    } else if (line.area_m2 && (line.operation === "asphalt" || line.operation === "prime" || line.operation === "spray_seal" || line.operation === "primer_seal")) {
      addFlag("CHECK", `Line ${line.line_ref}: no production rate "${rateKey}" set, shifts not calculated.`, "Rates");
    }

    if (line.check) {
      const why = line.assumption ?? (line.product_code ? "Check this line." : "No matching product.");
      addFlag("CHECK", `Line ${line.line_ref} (${line.description_as_written}): ${why}`, line.quantity_source === "assumed" ? "Assumed" : `Source: ${line.quantity_source}`);
    }

    return { ...line, tonnes_calc: tonnesCalc, shifts_calc: shiftsCalc, m2_per_shift_rate: rate?.value ?? null };
  });

  // Crew rate: by job type, travel band and the busiest asphalt line's m² per shift.
  const band = travelBand(ctx.haulMinutes);
  const asphalt = lines.filter((l) => l.operation === "asphalt" && l.area_m2 && l.shifts_calc);
  const m2PerShift = asphalt.length
    ? Math.max(...asphalt.map((l) => (l.area_m2 as number) / (l.shifts_calc as number)))
    : 0;
  const crew = asphalt.length ? crewRate(ctx.rates, answer.job.job_type, m2PerShift, band) : null;
  if (asphalt.length && !crew) addFlag("CHECK", `No crew rate found for ${answer.job.job_type}, ${band}.`, "Crew table");
  if (band === "unknown") addFlag("CHECK", "Haul time unknown; crew band assumed under 60 minutes.", "Routing");

  const extra = extraEstablishmentCost(answer.establishments.count, ctx.allowedEstablishments, ctx.settings.extra_establishment_rate);
  if (extra > 0) {
    addFlag("INFO", `${answer.establishments.count - ctx.allowedEstablishments} extra establishment(s) at the extra-establishment rate.`, "Settings");
  }

  // Rank: CHECK first, then questions, then info; keep the AI's order within each.
  const order = { CHECK: 0, QUESTION_FOR_CLIENT: 1, INFO: 2 } as const;
  const ranked = flags
    .map((f, i) => ({ f, i }))
    .sort((a, b) => order[a.f.severity] - order[b.f.severity] || (a.f.rank || 999) - (b.f.rank || 999) || a.i - b.i)
    .map(({ f }, i) => ({ ...f, rank: i + 1 }));

  return { answer, lines, crew, travel_band: band, extra_establishment_cost: extra, flags: ranked };
}
