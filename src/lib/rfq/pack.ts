/**
 * The job pack: one organised folder for a quote (the RFQ documents as filed, the Excel,
 * the overview and the measured areas), for a download now and Drive/OneDrive later.
 */
import type { DrawnArea, Overview } from "@/lib/rfq/overview";

export const PACK_FOLDERS = ["1. RFQ-Specs", "2. BOQ", "3. Drawings", "4. Correspondence", "5. Pricing"] as const;

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** The drawn areas as KML, which opens in Google Earth, Nearmap and most GIS tools. */
export function areasKml(title: string, areas: DrawnArea[]): string {
  const marks = areas.map((a) => {
    const ring = [...a.path, a.path[0]].map(([lat, lng]) => `${lng},${lat},0`).join(" ");
    const c = a.color.replace("#", "").toLowerCase();
    const abgr = `4d${c.slice(4, 6)}${c.slice(2, 4)}${c.slice(0, 2)}`;
    return `  <Placemark><name>${esc(a.name)} (${a.m2} m²)</name><Style><PolyStyle><color>${abgr}</color></PolyStyle><LineStyle><color>ff${abgr.slice(2)}</color><width>2</width></LineStyle></Style><Polygon><outerBoundaryIs><LinearRing><coordinates>${ring}</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>${esc(title)}</name>\n${marks.join("\n")}\n</Document></kml>\n`;
}

/** The overview as plain text, readable anywhere. */
export function overviewText(head: { title: string; quoteNo: string | null; customer: string | null; address: string | null }, ov: Overview | null): string {
  const out: string[] = [`JOB OVERVIEW: ${head.title}`, [head.quoteNo, head.customer, head.address].filter(Boolean).join(" | "), ""];
  if (!ov) return [...out, "The specs haven't been read for this quote yet."].join("\n");
  if (ov.summary) out.push(ov.summary, "");
  const sec = (name: string, lines: string[]) => { if (lines.length) out.push(name, ...lines.map((l) => `  - ${l}`), ""); };
  sec("Measured areas", (ov.areas ?? []).map((a) => `${a.name}: ${a.m2.toLocaleString("en-AU")} m²`));
  sec("Specs", ov.specs.map((s) => `${s.label}: ${s.value}${s.source ? `  [${s.source}]` : ""}`));
  sec("Dates", ov.key_dates.map((d) => `${d.label}: ${d.value}`));
  sec("Conditions", ov.conditions);
  sec("By others or excluded", ov.exclusions);
  sec("Documents", ov.documents.map((d) => `${d.name}: ${d.about}`));
  return out.join("\n");
}

/** A safe name for a file or folder in the pack. */
export const packName = (s: string, n = 120) => s.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "_").replace(/\s+/g, " ").trim().slice(0, n) || "file";
