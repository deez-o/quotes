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

import { areasKml, overviewText, packName } from "@/lib/rfq/pack";

describe("job pack", () => {
  it("writes areas as KML with lng,lat order and closed rings", () => {
    const k = areasKml("Car park <A>", [{ id: "a", name: "Bay & ramp", path: rect, m2: 1000, color: "#FF6A13" }]);
    expect(k).toContain("Car park &lt;A&gt;");
    expect(k).toContain("Bay &amp; ramp (1000 m²)");
    expect(k).toContain(`${lng0},${lat0},0`);
    const coords = k.match(/<coordinates>([^<]+)</)![1].split(" ");
    expect(coords[0]).toBe(coords[coords.length - 1]);
    expect(k).toContain("<color>4d136aff</color>");
  });
  it("makes safe names and readable text", () => {
    expect(packName('Q-1/2: "x"')).toBe("Q-1_2_ _x_");
    expect(overviewText({ title: "T", quoteNo: "Q-1", customer: null, address: null }, null)).toContain("haven't been read");
  });
});
