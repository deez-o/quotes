import { describe, expect, it } from "vitest";
import { depthWarning, hasMix, knownMix, mixForDepth } from "@/lib/mixes";

describe("known mixes", () => {
  it("spots real mixes in an item", () => {
    expect(knownMix("Supply and lay EME2, first layer")).toBe("EME2");
    expect(knownMix("Fischer Road 60mm AC14H (A15E)")).toBe("AC14");
    expect(knownMix("SMA 10 wearing course")).toBe("SMA10");
    expect(knownMix("AC7M")).toBe("AC7");
    expect(knownMix("OG14 open graded")).toBe("OG14");
    expect(knownMix("AC5")).toBeNull();
    expect(knownMix("Supply and spray prime")).toBeNull();
  });
  it("matches library names with extras on them", () => {
    expect(hasMix(["AC14 C320", "AC20"], "AC14")).toBe(true);
    expect(hasMix(["AC10"], "AC14")).toBe(false);
    expect(hasMix(["EME 2 Northside"], "EME2")).toBe(true);
  });
});

describe("layer depths", () => {
  it("warns when a mix is outside its spec depth", async () => {
    const { depthWarning } = await import("@/lib/mixes");
    expect(depthWarning("QLD", "AC14", 40)).toMatch(/under the 50 mm minimum/);
    expect(depthWarning("QLD", "AC14H (A15E)", 60)).toBeNull();
    expect(depthWarning("QLD", "EME2 base, 170 mm in two 85 mm layers", 170)).toBeNull(); // two 85 mm layers
    expect(depthWarning("VIC", "AC14", 40)).toBeNull(); // VIC: per drawings
    expect(depthWarning("NSW", "AC10", 60)).toMatch(/over the 50 mm/);
  });
  it("knows other states' names", async () => {
    const { knownMix } = await import("@/lib/mixes");
    expect(knownMix("Size 14 Type H")).toBe("14H");
    expect(knownMix("Mix Type 5")).toBe("Type5");
  });
});

describe("mix from depth", () => {
  it("picks the smallest dense mix the spec allows", async () => {
    const { mixForDepth } = await import("@/lib/mixes");
    expect(mixForDepth("QLD", 40)).toBe("AC10");
    expect(mixForDepth("QLD", 60)).toBe("AC14");
    expect(mixForDepth("QLD", 80)).toBe("AC20");
    expect(mixForDepth("QLD", 30)).toBe("AC7");
    expect(mixForDepth("NSW", 45)).toBe("AC10");
  });
});

describe("depths in every state", () => {
  it("suggests the state's dense mix from a depth", () => {
    expect(mixForDepth("VIC", 40)).toBe("10N");
    expect(mixForDepth("VIC", 50)).toBe("14N");
    expect(mixForDepth("SA", 60)).toBe("AC14");
    expect(mixForDepth("WA", 35)).toBe("AC10");
    expect(mixForDepth("ACT", 60)).toBe("AC14");
    expect(mixForDepth("NT", 50)).toBe("AC14");
  });
  it("warns against each state's spec", () => {
    expect(depthWarning("SA", "AC10", 25)).toMatch(/under the 30 mm minimum \(DIT/);
    expect(depthWarning("WA", "AC14 IC", 70)).toMatch(/over the 55 mm/);
    expect(knownMix("FineAC10 C320")).toBe("FineAC10");
  });
});
