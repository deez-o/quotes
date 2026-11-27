import { describe, expect, it } from "vitest";
import { cleanAreas, cleanOverview, polygonArea } from "@/lib/rfq/overview";

// A 50 m × 20 m rectangle in Brisbane: 1 degree of latitude ≈ 111,320 m.
const lat0 = -27.47, lng0 = 153.02;
const dLat = 20 / 111_320;
const dLng = 50 / (111_320 * Math.cos((lat0 * Math.PI) / 180));
const rect: [number, number][] = [[lat0, lng0], [lat0, lng0 + dLng], [lat0 + dLat, lng0 + dLng], [lat0 + dLat, lng0]];

describe("job overview", () => {
  it("measures a drawn area in m²", () => {
    expect(polygonArea(rect)).toBeGreaterThan(990);
    expect(polygonArea(rect)).toBeLessThan(1010);
  });

  it("works the area out again and drops bad shapes", () => {
    const areas = cleanAreas([
      { id: "a1", name: "Car park", path: rect, m2: 999_999, color: "#123456" },
      { id: "a2", name: "Too few", path: rect.slice(0, 2) },
      { id: "a3", name: "Bad", path: [[200, 0], [1, 1], [2, 2]] },
      { name: "", path: rect, color: "red; background:url(x)" },
    ]);
    expect(areas).toHaveLength(2);
    expect(areas[0].m2).toBeGreaterThan(990);
    expect(areas[0].m2).toBeLessThan(1010);
    expect(areas[1].name).toBe("Area 4");
    expect(areas[1].color).toBe("#FF6A13");
  });

  it("keeps only usable specs", () => {
    const o = cleanOverview({ summary: " Resheet ", specs: [{ label: "Wearing course", value: "AC10 40 mm", source: "spec.pdf p2" }, { label: "", value: "x" }] });
    expect(o.summary).toBe("Resheet");
    expect(o.specs).toHaveLength(1);
    expect(o.key_dates).toEqual([]);
  });
});
