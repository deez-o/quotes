import { describe, expect, it } from "vitest";
import { groundWidthM, parseScale } from "@/lib/rfq/plan-scale";

describe("plan scale", () => {
  it("reads scale and sheet", () => {
    expect(parseScale("DRAWN JB  SCALE 1:500 @ A1  REV C")).toEqual({ ratio: 500, sheet: "A1" });
    expect(parseScale("Scale: 1 : 250")).toEqual({ ratio: 250, sheet: null });
    expect(parseScale("no scale here, call 07 3000 1234")).toBeNull();
  });
  it("works out the ground width, even on a reduced print", () => {
    // A1 landscape is 841 mm wide: at 1:500 that's 420.5 m, whether the PDF is A1 or a reduced A3.
    expect(groundWidthM({ ratio: 500, sheet: "A1" }, 2384, 1684)).toBeCloseTo(420.5, 1);
    expect(groundWidthM({ ratio: 500, sheet: "A1" }, 1191, 842)).toBeCloseTo(420.5, 1);
    // No sheet given: use the PDF page itself (A3 = 420 mm).
    expect(groundWidthM({ ratio: 200, sheet: null }, 1190.55, 841.89)).toBeCloseTo(84, 0);
  });
});
