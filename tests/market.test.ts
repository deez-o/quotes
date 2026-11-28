import { describe, expect, it } from "vitest";
import { market, suburbOf, type MarketQuote } from "@/lib/market";

const q = (id: string, status: string, addr: string, margin: number, mixId: string, tonnes: number, rate: number): MarketQuote => ({
  id, status, created_at: "2026-11-01", site_address: addr, total_ex_gst: tonnes * rate,
  costing: { marginPercent: margin, priceExGst: tonnes * rate, perTonne: { tonnes, price: rate, profit: 0 }, customerLines: [{ key: "a", quantity: tonnes, unit: "t", rate, total: tonnes * rate }] },
  scope: { items: [{ key: "a", kind: "asphalt", cost_item_id: mixId }] },
});

describe("market numbers", () => {
  it("reads the suburb out of an address", () => {
    expect(suburbOf("Main St, Yamanto QLD 4305")).toBe("Yamanto");
    expect(suburbOf("174 Dowding St, OXLEY QLD 4075")).toBe("Oxley");
    expect(suburbOf("Fischer Rd, Ripley QLD")).toBe("Ripley");
    expect(suburbOf(null)).toBeNull();
  });

  it("splits wins by area, mix, margin and size", () => {
    const names: Record<string, string> = { ac10: "AC10", ac14: "AC14" };
    const m = market([
      q("1", "won", "A St, Yamanto QLD 4305", 12, "ac10", 200, 160),
      q("2", "lost", "B St, Yamanto QLD 4305", 22, "ac10", 50, 190),
      q("3", "won", "C St, Ripley QLD 4306", 14, "ac14", 1200, 150),
      q("4", "sent", "D St, Ripley QLD 4306", 15, "ac14", 80, 170),
    ], (id) => names[id] ?? null);
    expect(m.decided).toBe(3);
    expect(m.tonnesWon).toBe(1400);
    expect(m.areas.find((a) => a.area === "Yamanto")).toMatchObject({ quotes: 2, won: 1, lost: 1, winRate: 0.5 });
    expect(m.mixes.find((x) => x.mix === "AC10")).toMatchObject({ tonnesQuoted: 250, tonnesWon: 200, rateWon: 160, rateLost: 190 });
    expect(m.margins.find((b) => b.band === "20% and over")).toMatchObject({ lost: 1, winRate: 0 });
    expect(m.sizes.find((b) => b.band === "1,000 t and over")).toMatchObject({ won: 1 });
    expect(m.marginWon).toBe(13);
    expect(m.marginLost).toBe(22);
  });
});
