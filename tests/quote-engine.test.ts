import { describe, expect, it } from "vitest";
import {
  crewRate, extraEstablishmentCost, matchProduct, percentDifference, productionKey, tonnes, travelBand, wholeShifts,
} from "@/lib/quote/calc";
import { finishAnswer, validateAnswer } from "@/lib/quote/validate";
import { buildSystemPrompt, buildUserMessage } from "@/lib/quote/prompt";
import { costUsd, type ProviderResult, type QuoteProvider } from "@/lib/quote/provider";
import { draftQuote } from "@/lib/quote/draft";
import { RFQ_QUOTE_ANSWER_SCHEMA } from "@/lib/quote/schema";
import { demoBandedCrew, demoContext, demoProducts, demoRates, demoRules, demoSettings } from "./fixtures/demo-tenant";
import { carparkAnswer } from "./fixtures/answers";

describe("calc", () => {
  it("tonnes = m² × depth × density", () => {
    expect(tonnes(1850, 40, 2.4)).toBe(177.6);
    expect(tonnes(3626, 30, 2.45)).toBe(266.5);
    expect(tonnes(0, 40, 2.4)).toBe(0);
  });

  it("whole shifts, with leeway before adding a shift", () => {
    expect(wholeShifts(4500, 4500)).toBe(1);
    expect(wholeShifts(4501, 4500)).toBe(2);
    expect(wholeShifts(8800, 8000, 10)).toBe(1); // prime 8,000 + 10% leeway
    expect(wholeShifts(8801, 8000, 10)).toBe(2);
    expect(wholeShifts(100, 4500)).toBe(1);
    expect(wholeShifts(0, 4500)).toBe(0);
  });

  it("travel band switches above 60 minutes", () => {
    expect(travelBand(60)).toBe("under_60min");
    expect(travelBand(61)).toBe("over_60min");
    expect(travelBand(null)).toBe("unknown");
  });

  it("crew rate from a flat table", () => {
    expect(crewRate(demoRates, "subdivision", 4000, "under_60min")).toEqual({ key: "crew_under_60min", value: 1000 });
    expect(crewRate(demoRates, "subdivision", 4000, "over_60min")).toEqual({ key: "crew_over_60min", value: 1200 });
  });

  it("crew rate from a banded table by m² per shift and travel band", () => {
    expect(crewRate(demoBandedCrew, "subdivision", 3626, "under_60min")?.value).toBe(900);
    expect(crewRate(demoBandedCrew, "subdivision", 3626, "over_60min")?.value).toBe(1100);
    expect(crewRate(demoBandedCrew, "subdivision", 2000, "under_60min")?.value).toBe(800);
    expect(crewRate(demoBandedCrew, "subdivision", 500, "under_60min")?.value).toBe(700);
    expect(crewRate(demoBandedCrew, "road", 2000, "under_60min")).toBeNull();
  });

  it("production rate keys", () => {
    expect(productionKey("subdivision", "asphalt")).toBe("production_subdivision");
    expect(productionKey("carpark_bays_islands", "asphalt")).toBe("production_carpark_islands");
    expect(productionKey("road", "prime")).toBe("production_prime");
    expect(productionKey("road", "spray_seal")).toBe("production_spray");
  });

  it("extra establishments and differences", () => {
    expect(extraEstablishmentCost(4, 2, 2500)).toBe(5000);
    expect(extraEstablishmentCost(1, 2, 2500)).toBe(0);
    expect(extraEstablishmentCost(4, 2, null)).toBe(0);
    expect(percentDifference(6448, 6862)).toBeCloseTo(6.03, 1);
  });

  it("matches what customers write to products", () => {
    expect(matchProduct(demoProducts, "AC 10 mix")?.code).toBe("AC10");
    expect(matchProduct(demoProducts, "ac15")?.code).toBe("AC14");
    expect(matchProduct(demoProducts, "Discontinued mix")).toBeUndefined();
    expect(matchProduct(demoProducts, "unknown")).toBeUndefined();
  });
});

describe("validate", () => {
  it("accepts a clean answer", () => {
    expect(validateAnswer(carparkAnswer(), demoContext()).errors).toEqual([]);
  });

  it("rejects products not on the list or inactive", () => {
    const a = carparkAnswer();
    a.scope[0].product_code = "AC15";
    a.scope[1].product_code = "OLD1";
    const { errors } = validateAnswer(a, demoContext());
    expect(errors.join(" ")).toContain("AC15 is not in the product list");
    expect(errors.join(" ")).toContain("OLD1 is inactive");
  });

  it("requires check=true when product is null or an assumption is made", () => {
    const a = carparkAnswer();
    a.scope[0].product_code = null;
    a.scope[1].check = false;
    const { errors } = validateAnswer(a, demoContext());
    expect(errors).toHaveLength(2);
  });

  it("rejects priced quantities without an area, bad dates and duplicate refs", () => {
    const a = carparkAnswer();
    a.scope[0].area_m2 = null;
    a.dates.due = "next Friday";
    a.scope[1].line_ref = "1";
    const { errors } = validateAnswer(a, demoContext());
    expect(errors.some((e) => e.includes("area_m2 is missing"))).toBe(true);
    expect(errors.some((e) => e.includes("not a real date"))).toBe(true);
    expect(errors.some((e) => e.includes("used twice"))).toBe(true);
  });

  it("rejects an RFQ with no scope", () => {
    const a = carparkAnswer();
    a.scope = [];
    a.shifts = [];
    expect(validateAnswer(a, demoContext()).errors[0]).toContain("scope is empty");
  });
});

describe("finish (code decides the numbers)", () => {
  it("recalculates tonnes, shifts, crew and ranks flags", () => {
    const a = carparkAnswer();
    a.scope[0].tonnes = 150; // wrong on purpose
    const f = finishAnswer(a, demoContext());
    expect(f.lines[0].tonnes_calc).toBe(177.6);
    expect(f.lines[0].shifts_calc).toBe(3); // 1,850 / 900 = 2.06 -> 3
    expect(f.lines[1].shifts_calc).toBe(1); // prime 1,850 / 8,800
    expect(f.crew).toEqual({ key: "crew_under_60min", value: 1000 });
    expect(f.travel_band).toBe("under_60min");
    expect(f.flags[0].severity).toBe("CHECK");
    expect(f.flags.map((x) => x.rank)).toEqual(f.flags.map((_, i) => i + 1));
    expect(f.flags.some((x) => x.text.includes("tonnes recalculated to 177.6"))).toBe(true);
    expect(f.flags.some((x) => x.text.includes("sealer to base"))).toBe(true);
  });

  it("flags a shift count that differs from the production rate", () => {
    const a = carparkAnswer();
    a.shifts[0].shifts = 2;
    const f = finishAnswer(a, demoContext());
    expect(f.flags.some((x) => x.text.includes("production rate gives 3 shift(s); draft says 2"))).toBe(true);
  });

  it("uses the over-60 band for long hauls and charges extra establishments", () => {
    const a = carparkAnswer();
    a.establishments.count = 3;
    const f = finishAnswer(a, demoContext({ haulMinutes: 75 }));
    expect(f.crew?.key).toBe("crew_over_60min");
    expect(f.extra_establishment_cost).toBe(2500);
  });

  it("flags unknown haul", () => {
    const f = finishAnswer(carparkAnswer(), demoContext({ haulMinutes: null }));
    expect(f.flags.some((x) => x.text.startsWith("Haul time unknown"))).toBe(true);
  });
});

describe("prompt", () => {
  const sys = buildSystemPrompt({
    tradingName: "Demo Asphalt Co", rules: demoRules, products: demoProducts, settings: demoSettings, examples: [],
  });

  it("includes this tenant's rules, active products and settings, never prices", () => {
    expect(sys).toContain("Demo Asphalt Co");
    expect(sys).toContain("R16. If no binder is stated");
    expect(sys).toContain("## Mixes and binders");
    expect(sys).toContain("AC10 | AC10 dense 10 mm | asphalt | 2.4");
    expect(sys).not.toContain("OLD1");
    expect(sys).toContain("Default binder: C320");
    expect(sys).toContain('calc in Excel');
  });

  it("is identical between calls (cacheable)", () => {
    const again = buildSystemPrompt({
      tradingName: "Demo Asphalt Co", rules: demoRules, products: demoProducts, settings: demoSettings, examples: [],
    });
    expect(again).toBe(sys);
  });

  it("caps long emails and lists attachments, drawings and haul", () => {
    const msg = buildUserMessage({
      email: { from: "sam@baysidedev.example", to: "sales@demo.example", received_at: "2026-11-26 08:12", subject: "RFQ carpark", body: "x".repeat(25000) },
      thread_summary: null,
      attachments: [{ id: "a1", filename: "BoQ.xlsx", kind_guess: "boq", pages: null, size_bytes: 12000 }],
      extracted: [{ attachment_id: "a1", text: "Item,Qty\nAC10 40mm,1850", truncated: false }],
      drawings: [{ attachment_id: "a2", page: 1, title: "C-101 Site plan", scale: "1:250 @ A1", widths_m: [6.5, 6.4], notes: null }],
      haul: { km: 34, minutes: 42, from: "Brendale depot" },
      related_quotes: [],
    });
    expect(msg).toContain("[email truncated]");
    expect(msg).toContain("a1 | BoQ.xlsx | boq");
    expect(msg).toContain("widths 6.5 m, 6.4 m");
    expect(msg).toContain("34 km, 42 min one way from Brendale depot");
  });
});

describe("schema and cost", () => {
  it("is strict and requires every top-level field", () => {
    expect(RFQ_QUOTE_ANSWER_SCHEMA.strict).toBe(true);
    expect(RFQ_QUOTE_ANSWER_SCHEMA.schema.required).toContain("scope");
    expect(RFQ_QUOTE_ANSWER_SCHEMA.schema.additionalProperties).toBe(false);
  });

  it("costs a call from token usage", () => {
    // 25k cached + 15k fresh in, 6k out on grok-4.3 (brief's worked example)
    const c = costUsd("grok-4.3", { input_tokens: 40000, cached_tokens: 25000, output_tokens: 6000 });
    expect(c).toBeCloseTo(0.005 + 0.01875 + 0.015, 5);
    expect(costUsd("unknown-model", { input_tokens: 1, cached_tokens: 0, output_tokens: 1 })).toBeNull();
  });
});

class FakeProvider implements QuoteProvider {
  readonly name = "fake";
  readonly model = "grok-4.3";
  calls: (string | undefined)[] = [];
  constructor(private readonly answers: unknown[]) {}
  async draft(_s: string, _u: string, retryNote?: string): Promise<ProviderResult> {
    this.calls.push(retryNote);
    const json = this.answers[Math.min(this.calls.length - 1, this.answers.length - 1)];
    return { provider: this.name, model: this.model, json, usage: { input_tokens: 40000, cached_tokens: 25000, output_tokens: 6000 }, latency_ms: 5 };
  }
}

const promptInput = { tradingName: "Demo Asphalt Co", rules: demoRules, products: demoProducts, settings: demoSettings, examples: [] };
const bundle = {
  email: { from: "a@b.example", to: "sales@demo.example", received_at: "2026-11-26", subject: "RFQ", body: "Please price" },
  thread_summary: null, attachments: [], extracted: [], drawings: [], haul: { km: 34, minutes: 42, from: null }, related_quotes: [],
};

describe("draftQuote", () => {
  it("drafts first time when the answer passes", async () => {
    const p = new FakeProvider([carparkAnswer()]);
    const out = await draftQuote(p, promptInput, bundle, demoContext());
    expect(out.status).toBe("drafted");
    expect(p.calls).toHaveLength(1);
    expect(out.runs[0].valid).toBe(true);
    expect(out.runs[0].cost_usd).toBeGreaterThan(0);
  });

  it("retries once with the errors, then drafts", async () => {
    const bad = carparkAnswer();
    bad.scope[0].product_code = "AC15";
    const p = new FakeProvider([bad, carparkAnswer()]);
    const out = await draftQuote(p, promptInput, bundle, demoContext());
    expect(out.status).toBe("drafted");
    expect(p.calls[1]).toContain("AC15 is not in the product list");
    expect(out.runs.map((r) => r.valid)).toEqual([false, true]);
  });

  it("gives up after two failed attempts: Needs Attention", async () => {
    const bad = carparkAnswer();
    bad.scope[0].product_code = "AC15";
    const p = new FakeProvider([bad, bad]);
    const out = await draftQuote(p, promptInput, bundle, demoContext());
    expect(out.status).toBe("needs_attention");
    expect(p.calls).toHaveLength(2);
  });

  it("handles a provider error without retrying blindly", async () => {
    const p: QuoteProvider = { name: "x", model: "m", draft: async () => { throw new Error("timeout"); } };
    const out = await draftQuote(p, promptInput, bundle, demoContext());
    expect(out.status).toBe("needs_attention");
  });
});
