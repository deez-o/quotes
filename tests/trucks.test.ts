import { describe, expect, test } from "vitest";
import { DEFAULT_CARTAGE, planTrucks } from "@/lib/site/trucks";

const base = { capacity: 30, loadMinutes: 15, unloadMinutes: 10, shiftMinutes: 600 };

describe("planTrucks", () => {
  test("an hour from the plant: 2 rounds", () => {
    const p = planTrucks({ ...base, tonnes: 600, shifts: 1, minutesEachWay: 65 });
    expect(p.loads).toBe(20);
    expect(p.rounds).toBe(2);
    expect(p.trucks).toBe(10);
  });
  test("40 minutes away: 3 rounds", () => {
    expect(planTrucks({ ...base, tonnes: 600, shifts: 1, minutesEachWay: 40 }).rounds).toBe(3);
  });
  test("down the road: 4 rounds", () => {
    const p = planTrucks({ ...base, tonnes: 600, shifts: 1, minutesEachWay: 15 });
    expect(p.rounds).toBe(4);
    expect(p.trucks).toBe(5);
  });
  test("a small job an hour away goes in one round", () => {
    const p = planTrucks({ ...base, tonnes: 70, shifts: 1, minutesEachWay: 60 });
    expect(p.loads).toBe(3);
    expect(p.rounds).toBe(1);
    expect(p.trucks).toBe(3);
  });
  test("split over the paving shifts", () => {
    const p = planTrucks({ ...base, tonnes: 1800, shifts: 3, minutesEachWay: 65 });
    expect(p.loadsPerShift).toBe(20);
    expect(p.trucks).toBe(10);
  });
  test("never more rounds than fit in the day", () => {
    const p = planTrucks({ ...base, tonnes: 900, shifts: 1, minutesEachWay: 25, shiftMinutes: 180, rules: DEFAULT_CARTAGE });
    expect(p.rounds).toBe(2);
  });
});
