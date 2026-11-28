/**
 * How many trucks a job needs, the way an asphalt crew runs it: the further the job is from the
 * asphalt plant, the fewer rounds each truck can do in a shift, so the more trucks it takes.
 * Small jobs go in one round. Pure, so it can be shown and tested.
 */

export type CartageRules = {
  /** One way from the plant, minutes, at or over which a truck does `farRounds` a shift. */
  farMinutes: number;
  farRounds: number;
  /** At or over this (and under farMinutes): `midRounds`. Under it: `nearRounds`. */
  midMinutes: number;
  midRounds: number;
  nearRounds: number;
  /** A shift needing this many loads or fewer is sent all at once (one round). */
  oneRoundLoads: number;
};

export const DEFAULT_CARTAGE: CartageRules = { farMinutes: 60, farRounds: 2, midMinutes: 30, midRounds: 3, nearRounds: 4, oneRoundLoads: 4 };

export function cleanCartage(raw: unknown): CartageRules {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const n = (k: keyof CartageRules, lo: number, hi: number) => {
    const v = Number(o[k]);
    return Number.isFinite(v) && v >= lo && v <= hi ? Math.round(v) : DEFAULT_CARTAGE[k];
  };
  const r = { farMinutes: n("farMinutes", 5, 300), farRounds: n("farRounds", 1, 10), midMinutes: n("midMinutes", 1, 300), midRounds: n("midRounds", 1, 12), nearRounds: n("nearRounds", 1, 15), oneRoundLoads: n("oneRoundLoads", 0, 30) };
  if (r.midMinutes >= r.farMinutes) r.midMinutes = Math.max(1, r.farMinutes - 1);
  return r;
}

export type TruckPlan = {
  loads: number;
  shifts: number;
  loadsPerShift: number;
  tonnesPerShift: number;
  cycleMinutes: number;
  rounds: number;
  trucks: number;
  /** Hours each truck works a shift (rounds x cycle). */
  hoursPerTruck: number;
  /** Plain words: why that many rounds. */
  why: string;
};

export function planTrucks(i: {
  tonnes: number; capacity: number; shifts: number; minutesEachWay: number;
  loadMinutes: number; unloadMinutes: number; shiftMinutes: number; rules?: CartageRules;
}): TruckPlan {
  const rules = i.rules ?? DEFAULT_CARTAGE;
  const capacity = i.capacity > 0 ? i.capacity : 12;
  const loads = Math.max(1, Math.ceil(i.tonnes / capacity - 1e-9));
  const shifts = Math.max(1, Math.min(Math.round(i.shifts) || 1, loads));
  const loadsPerShift = Math.ceil(loads / shifts);
  const cycle = 2 * i.minutesEachWay + i.loadMinutes + i.unloadMinutes;
  const m = i.minutesEachWay;
  let rounds = m >= rules.farMinutes ? rules.farRounds : m >= rules.midMinutes ? rules.midRounds : rules.nearRounds;
  let why = m >= rules.farMinutes ? `${m} min from the plant (${rules.farMinutes} min or more): ${rules.farRounds} rounds`
    : m >= rules.midMinutes ? `${m} min from the plant (${rules.midMinutes}-${rules.farMinutes} min): ${rules.midRounds} rounds`
    : `${m} min from the plant (under ${rules.midMinutes} min): ${rules.nearRounds} rounds`;
  // A truck can't do more rounds than fit in its working day.
  const fit = Math.max(1, Math.floor(i.shiftMinutes / Math.max(1, cycle)));
  if (rounds > fit) { rounds = fit; why += `, but only ${fit} fit in a ${Math.round(i.shiftMinutes / 60 * 10) / 10} h day at a ${cycle} min cycle`; }
  if (loadsPerShift <= rules.oneRoundLoads) { rounds = 1; why = `${loadsPerShift} load${loadsPerShift === 1 ? "" : "s"} a shift: sent all at once, one round`; }
  rounds = Math.max(1, Math.min(rounds, loadsPerShift));
  const trucks = Math.ceil(loadsPerShift / rounds);
  return {
    loads, shifts, loadsPerShift, tonnesPerShift: Math.round((i.tonnes / shifts) * 10) / 10,
    cycleMinutes: cycle, rounds, trucks, hoursPerTruck: Math.round((rounds * cycle) / 60 * 100) / 100, why,
  };
}
