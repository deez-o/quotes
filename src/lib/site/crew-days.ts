/**
 * How many crew shifts a job takes, from the m² a crew lays in a 10-hour day.
 * Whole shifts only. Just over a whole number of shifts (within stretch %), it stays at that
 * number on 12-hour days instead of adding a shift: 7,861 m² at 3,700 a day = 2 shifts at 12 h.
 */
import type { SiteScope } from "./price";

export type CrewOutput = {
  subdivisionNear: number; subdivisionFar: number; carpark: number; near: number; far: number;
  farMinutes: number; stretchPercent: number; hours: number; longHours: number;
};

export const DEFAULT_CREW_OUTPUT: CrewOutput = {
  subdivisionNear: 5000, subdivisionFar: 4500, carpark: 2500, near: 4500, far: 3700,
  farMinutes: 60, stretchPercent: 15, hours: 10, longHours: 12,
};

export function cleanCrewOutput(raw: unknown): CrewOutput {
  const o = (raw ?? {}) as Record<string, unknown>;
  const n = (k: keyof CrewOutput, lo: number, hi: number) => {
    const v = Number(o[k]);
    return Number.isFinite(v) && v >= lo && v <= hi ? v : DEFAULT_CREW_OUTPUT[k];
  };
  return {
    subdivisionNear: n("subdivisionNear", 100, 50000), subdivisionFar: n("subdivisionFar", 100, 50000), carpark: n("carpark", 100, 50000),
    near: n("near", 100, 50000), far: n("far", 100, 50000), farMinutes: n("farMinutes", 5, 600), stretchPercent: n("stretchPercent", 0, 50),
    hours: n("hours", 1, 24), longHours: n("longHours", 1, 24),
  };
}

/** m² a day for this job: by job type, and less when the haul is long. */
export function perDay(jobType: string | undefined, haulMinutes: number | null, o: CrewOutput): number {
  const far = haulMinutes != null && haulMinutes > o.farMinutes;
  if (jobType === "carpark") return o.carpark;
  if (jobType === "subdivision") return far ? o.subdivisionFar : o.subdivisionNear;
  return far ? o.far : o.near;
}

/** Whole shifts for m², with the 12-hour stretch. */
export function shiftsFor(m2: number, day: number, o: CrewOutput): { shifts: number; hours: number } {
  if (!(m2 > 0) || !(day > 0)) return { shifts: 0, hours: o.hours };
  const full = Math.floor(m2 / day);
  const rem = m2 - full * day;
  if (full === 0) return { shifts: 1, hours: o.hours };
  if (rem === 0) return { shifts: full, hours: o.hours };
  if (rem <= (day * o.stretchPercent) / 100) return { shifts: full, hours: o.longHours };
  return { shifts: full + 1, hours: o.hours };
}

/** Layers in one item: "170 mm in two 85 mm layers" = 2. */
export function layersOf(description: string): number {
  const m = description.match(/\b(two|three|four|2|3|4)\s*(?:x\s*)?(?:\d+\s*mm\s*)?layers?\b/i);
  if (!m) return 1;
  return ({ two: 2, three: 3, four: 4 } as Record<string, number>)[m[1].toLowerCase()] ?? Number(m[1]);
}

/**
 * Set the hourly crew's days and hours from the asphalt m² (each layer counts), at least one shift
 * per asphalt establishment. Returns the scope and a note for the assumptions, or null if nothing to do.
 */
export function planCrew(scope: SiteScope, haulMinutes: number | null, o: CrewOutput, hourly: (costItemId: string) => boolean): { scope: SiteScope; note: string } | null {
  const m2 = scope.items.filter((i) => i.kind === "asphalt" && i.area_m2).reduce((s, i) => s + i.area_m2! * layersOf(i.description), 0);
  if (!(m2 > 0) || !scope.crew.some((l) => hourly(l.cost_item_id))) return null;
  const factor = scope.paving_factor && scope.paving_factor > 0 ? Math.min(1.1, Math.max(0.3, scope.paving_factor)) : 1;
  const day = Math.round(perDay(scope.job_type, haulMinutes, o) * factor / 50) * 50;
  const plan = shiftsFor(m2, day, o);
  const minimum = Math.max(1, scope.float_moves ?? 1);
  const shifts = Math.max(plan.shifts, minimum);
  const hours = shifts > plan.shifts ? o.hours : plan.hours;
  const crew = scope.crew.map((l) => (hourly(l.cost_item_id) ? { ...l, days: shifts, amount: hours } : l));
  const why = shifts > plan.shifts
    ? `at least one shift for each of the ${minimum} asphalt set-ups`
    : plan.hours === o.longHours ? `just over ${plan.shifts} shift${plan.shifts === 1 ? "" : "s"}, so ${o.longHours}-hour days instead of another shift` : `${o.hours}-hour days`;
  const note = `Crew: ${Math.round(m2).toLocaleString("en-AU")} m² of asphalt at about ${day.toLocaleString("en-AU")} m² a shift${haulMinutes != null && haulMinutes > o.farMinutes ? " (long haul)" : ""}${factor !== 1 ? ` (${Math.round(factor * 100)}% of a normal day, from the plans)` : ""} = ${shifts} shift${shifts === 1 ? "" : "s"}, ${why}.`;
  return { scope: { ...scope, crew }, note };
}
