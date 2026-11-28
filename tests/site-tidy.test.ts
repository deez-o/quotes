import { describe, expect, it } from "vitest";
import { tidyItems } from "@/lib/site/tidy";
import type { ScopeItem } from "@/lib/site/price";

const it_ = (key: string, kind: ScopeItem["kind"], area: number, cost: string, description: string = kind): ScopeItem =>
  ({ key, kind, description, area_m2: area, depth_mm: kind === "asphalt" ? 40 : null, cost_item_id: cost, quantity: null });

describe("tidying the job lines", () => {
  it("puts one prime line over the whole area, above the asphalt", () => {
    const out = tidyItems([it_("a", "asphalt", 8232, "ac10"), it_("p1", "prime", 8232, "k2", "Prime"), it_("b", "asphalt", 1311, "ac14"), it_("p2", "prime", 1311, "k2", "Prime")]);
    expect(out.map((i) => i.key)).toEqual(["p1", "a", "b"]);
    expect(out[0].area_m2).toBe(9543);
  });
  it("keeps different prime products apart", () => {
    const out = tidyItems([it_("p1", "prime", 100, "k2"), it_("p2", "prime", 50, "amc0")]);
    expect(out).toHaveLength(2);
  });
});
