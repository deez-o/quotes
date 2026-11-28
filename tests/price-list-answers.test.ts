import { describe, expect, it } from "vitest";
import { applyAnswers, cleanPriceList } from "@/lib/site/price-list";

const read = cleanPriceList({
  supplier: "Demo Plant", valid_until: null, gst: "included", base_binder: null, binder_extras: [], warnings: [],
  lines: [
    { name: "AC14 C320", unit: "t", rate: 165, kind: "asphalt", notes: null, band: "" },
    { name: "AC14 C600", unit: "t", rate: 176, kind: "asphalt", notes: null, band: "" },
    { name: "AC10 C320", unit: "t", rate: 170, kind: "asphalt", notes: null, band: "" },
    { name: "AC10 C600", unit: "t", rate: 181, kind: "asphalt", notes: null, band: "" },
  ],
  questions: [{ topic: "binders", question: "Each mix is priced in two binders.", options: ["Keep each binder as its own mix", "One price per mix, other binders as extras"], suggested: 1 }],
});

describe("price list answers", () => {
  it("asks about GST when the prices include it", () => {
    expect(read.questions.map((q) => q.topic)).toEqual(["gst", "binders"]);
  });
  it("takes GST off and turns binder versions into one mix plus an extra", () => {
    const out = applyAnswers(read, [0, 1]);
    expect(out.lines.map((l) => l.name)).toEqual(["AC14 C320", "AC10 C320"]);
    expect(out.lines[0].rate).toBe(150);
    expect(out.extras).toEqual([{ binder: "C600", extra_per_t: 10, applies_to: null, notes: null }]);
    expect(out.base).toBe("C320");
  });
  it("keeps every line when told to", () => {
    expect(applyAnswers(read, [1, 0]).lines).toHaveLength(4);
  });
});
