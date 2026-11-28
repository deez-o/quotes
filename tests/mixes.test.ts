import { describe, expect, it } from "vitest";
import { hasMix, knownMix } from "@/lib/mixes";

describe("known mixes", () => {
  it("spots real mixes in an item", () => {
    expect(knownMix("Supply and lay EME2, first layer")).toBe("EME2");
    expect(knownMix("Fischer Road 60mm AC14H (A15E)")).toBe("AC14");
    expect(knownMix("SMA 10 wearing course")).toBe("SMA10");
    expect(knownMix("Supply and spray prime")).toBeNull();
  });
  it("matches library names with extras on them", () => {
    expect(hasMix(["AC14 C320", "AC20"], "AC14")).toBe(true);
    expect(hasMix(["AC10"], "AC14")).toBe(false);
    expect(hasMix(["EME 2 Northside"], "EME2")).toBe(true);
  });
});
