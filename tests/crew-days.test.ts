import { describe, expect, it } from "vitest";
import { DEFAULT_CREW_OUTPUT as O, layersOf, perDay, shiftsFor } from "@/lib/site/crew-days";

describe("crew shifts", () => {
  it("stretches to 12-hour days when just over", () => {
    expect(shiftsFor(7861, 3700, O)).toEqual({ shifts: 2, hours: 12 }); // 12.5% over 2 shifts: within 15%
    expect(shiftsFor(4200, 4000, O)).toEqual({ shifts: 1, hours: 12 });
    expect(shiftsFor(11186, 3700, O)).toEqual({ shifts: 3, hours: 12 }); // Winslow Newton: 3 shifts
    expect(shiftsFor(9000, 4000, O)).toEqual({ shifts: 3, hours: 10 }); // 25% over: another shift
    expect(shiftsFor(800, 2500, O)).toEqual({ shifts: 1, hours: 10 });
  });
  it("lays less a day on far jobs and car parks", () => {
    expect(perDay("subdivision", 40, O)).toBe(5000);
    expect(perDay("subdivision", 75, O)).toBe(4500);
    expect(perDay("carpark", 10, O)).toBe(2500);
    expect(perDay("road", 74, O)).toBe(3700);
  });
  it("counts layers", () => {
    expect(layersOf("EME2 base, 170 mm in two 85 mm layers")).toBe(2);
    expect(layersOf("AC14 60 mm")).toBe(1);
  });
});
