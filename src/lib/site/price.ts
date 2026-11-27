/**
 * Site-quote pricing: plain code, never the AI. Turns a scope (what was said
 * on site, as checked by the user) plus the customer's costs library into
 * costs, a price at their margin, and clean customer line items.
 * Every number carries its working so the user can see how it was reached.
 * Pure functions: runs on the server and live in the phone browser.
 */

export type CostItem = {
  id: string;
  category: "crew" | "material" | "plant" | "truck" | "other";
  material_kind: "asphalt" | "base" | "prime" | "seal" | "other" | null;
  name: string;
  unit: "shift" | "day" | "h" | "t" | "m2" | "m3" | "each" | "km";
  rate: number;
  density_t_per_m3: number | null;
  includes_delivery: boolean;
  truck_capacity_t: number | null;
  active: boolean;
};

export type SupplyPlant = { id: string; name: string; lat: number | null; lng: number | null };

export type ScopeItemKind = "asphalt" | "base" | "prime" | "seal" | "excavation" | "other";

export type ScopeItem = {
  key: string;
  kind: ScopeItemKind;
  description: string;
  area_m2: number | null;
  depth_mm: number | null;
  /** Cost item for the material (or the work, for "other"). */
  cost_item_id: string | null;
  /** For items not measured by area (e.g. 3 each, 12 m3). */
  quantity: number | null;
};

export type LabourLine = { key: string; cost_item_id: string; amount: number; note: string | null }; // shifts, hours, days...

export type SiteScope = {
  title: string;
  job_type: string;
  items: ScopeItem[];
  crew: LabourLine[];
  plant: LabourLine[];
  supply_plant_id: string | null;
  truck_cost_item_id: string | null;
  assumptions: string[];
  questions: string[];
};

export type PricingSettings = {
  truck_load_minutes: number;
  truck_unload_minutes: number;
  shift_minutes: number;
  road_factor: number;
  average_speed_kmh: number;
  gst_percent: number;
};

export type Haul = { km: number; minutes: number; source: "gps" | "entered" };

export type CostLine = {
  key: string;
  group: "material" | "trucks" | "crew" | "plant" | "other";
  label: string;
  working: string;
  cost: number;
};

export type CustomerLine = { key: string; description: string; quantity: number; unit: string; rate: number; total: number };

export type Priced = {
  costLines: CostLine[];
  customerLines: CustomerLine[];
  cost: number;
  marginPercent: number;
  priceExGst: number;
  profit: number;
  gst: number;
  priceIncGst: number;
  trucks: { loads: number; trucks: number; cycleMinutes: number; hours: number; tonnes: number } | null;
  haul: Haul | null;
  warnings: string[];
};

const round2 = (n: number) => Math.round(n * 100) / 100;
const fmtN = (n: number, dp = 1) => Number(n.toFixed(dp)).toLocaleString("en-AU");
export const money = (n: number) =>
  `$${n.toLocaleString("en-AU", { minimumFractionDigits: 0, maximumFractionDigits: n % 1 === 0 ? 0 : 2 })}`;

/** Straight-line distance (km) between two points. */
export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(a));
}

/** Approximate road distance and drive time from the plant to the site. */
export function estimateHaul(site: { lat: number; lng: number }, plant: SupplyPlant, s: PricingSettings): Haul | null {
  if (plant.lat == null || plant.lng == null) return null;
  const km = haversineKm(site.lat, site.lng, plant.lat, plant.lng) * s.road_factor;
  return { km: Math.round(km * 10) / 10, minutes: Math.round((km / s.average_speed_kmh) * 60), source: "gps" };
}

/** Tonnes of material for an area at a depth. */
export function tonnesFor(areaM2: number, depthMm: number, density: number): number {
  return Math.round(areaM2 * (depthMm / 1000) * density * 10) / 10;
}

const UNIT_LABEL: Record<CostItem["unit"], string> = {
  shift: "shift", day: "day", h: "h", t: "t", m2: "m²", m3: "m³", each: "each", km: "km",
};

/** Price a scope. `marginPercent` is margin on the selling price (price = cost / (1 − margin)). */
export function priceSiteQuote(input: {
  scope: SiteScope;
  library: CostItem[];
  settings: PricingSettings;
  haul: Haul | null;
  marginPercent: number;
}): Priced {
  const { scope, library, settings, haul } = input;
  const marginPercent = Math.min(90, Math.max(0, input.marginPercent));
  const byId = new Map(library.map((c) => [c.id, c]));
  const warnings: string[] = [];
  const costLines: CostLine[] = [];
  /** Direct cost per scope item, to spread shared costs onto customer lines. */
  const direct = new Map<string, number>();
  let truckTonnes = 0;

  for (const item of scope.items) {
    const ci = item.cost_item_id ? byId.get(item.cost_item_id) : undefined;
    if (!ci) {
      warnings.push(`"${item.description}" has no matching cost in your library, so it isn't priced.`);
      direct.set(item.key, 0);
      continue;
    }
    let qty = 0;
    let working = "";
    let tonnes = 0;

    if ((item.kind === "asphalt" || item.kind === "base") && ci.unit === "t") {
      if (!item.area_m2 || !item.depth_mm) {
        warnings.push(`"${item.description}" needs an area and a depth.`);
      } else if (!ci.density_t_per_m3) {
        warnings.push(`${ci.name} has no density in your library, so tonnes can't be worked out.`);
      } else {
        tonnes = tonnesFor(item.area_m2, item.depth_mm, ci.density_t_per_m3);
        qty = tonnes;
        working = `${fmtN(item.area_m2, 0)} m² × ${item.depth_mm / 1000} m × ${ci.density_t_per_m3} t/m³ = ${fmtN(tonnes)} t × ${money(ci.rate)}/t`;
        if (!ci.includes_delivery) truckTonnes += tonnes;
      }
    } else if (ci.unit === "m3") {
      const m3 = item.quantity ?? (item.area_m2 && item.depth_mm ? round2(item.area_m2 * (item.depth_mm / 1000)) : 0);
      qty = m3;
      working = item.quantity ? `${fmtN(m3)} m³ × ${money(ci.rate)}/m³` : `${fmtN(item.area_m2 ?? 0, 0)} m² × ${(item.depth_mm ?? 0) / 1000} m = ${fmtN(m3)} m³ × ${money(ci.rate)}/m³`;
      if (!m3) warnings.push(`"${item.description}" needs a volume, or an area and a depth.`);
    } else if (ci.unit === "m2") {
      qty = item.area_m2 ?? item.quantity ?? 0;
      working = `${fmtN(qty, 0)} m² × ${money(ci.rate)}/m²`;
      if (!qty) warnings.push(`"${item.description}" needs an area.`);
    } else {
      qty = item.quantity ?? 0;
      working = `${fmtN(qty)} ${UNIT_LABEL[ci.unit]} × ${money(ci.rate)}/${UNIT_LABEL[ci.unit]}`;
      if (!qty) warnings.push(`"${item.description}" needs a quantity.`);
    }

    const cost = round2(qty * ci.rate);
    direct.set(item.key, cost);
    costLines.push({ key: item.key, group: "material", label: item.description, working, cost });
  }

  // Trucks: haul everything not delivered by the supplier from the supply plant.
  let trucks: Priced["trucks"] = null;
  if (truckTonnes > 0) {
    const truck = scope.truck_cost_item_id ? byId.get(scope.truck_cost_item_id) : library.find((c) => c.category === "truck" && c.active);
    if (!truck) {
      warnings.push("No truck rate in your library, so cartage isn't priced.");
    } else if (!haul) {
      warnings.push("Distance to the plant is unknown (no site location or plant location), so cartage isn't priced.");
    } else {
      const capacity = truck.truck_capacity_t ?? 12;
      const loads = Math.ceil(truckTonnes / capacity - 1e-9);
      const cycle = 2 * haul.minutes + settings.truck_load_minutes + settings.truck_unload_minutes;
      const hours = round2((loads * cycle) / 60);
      const trucksNeeded = Math.min(loads, Math.max(1, Math.ceil((loads * cycle) / settings.shift_minutes)));
      const rateUnit = truck.unit === "h" ? hours : truck.unit === "km" ? loads * 2 * haul.km : truck.unit === "each" || truck.unit === "day" ? trucksNeeded : hours;
      const cost = round2(rateUnit * truck.rate);
      trucks = { loads, trucks: trucksNeeded, cycleMinutes: cycle, hours, tonnes: round2(truckTonnes) };
      costLines.push({
        key: "trucks",
        group: "trucks",
        label: `Cartage from plant (${trucksNeeded} truck${trucksNeeded === 1 ? "" : "s"})`,
        working: `${fmtN(truckTonnes)} t ÷ ${capacity} t = ${loads} loads × ${cycle} min cycle (${haul.minutes} min each way + load/unload) = ${fmtN(hours, 2)} h × ${money(truck.rate)}/h`,
        cost,
      });
    }
  }

  for (const [group, lines] of [["crew", scope.crew], ["plant", scope.plant]] as const) {
    for (const l of lines) {
      const ci = byId.get(l.cost_item_id);
      if (!ci) {
        warnings.push(`A ${group} line refers to a cost that isn't in your library.`);
        continue;
      }
      const cost = round2(l.amount * ci.rate);
      costLines.push({
        key: l.key, group, label: ci.name,
        working: `${fmtN(l.amount)} ${UNIT_LABEL[ci.unit]} × ${money(ci.rate)}/${UNIT_LABEL[ci.unit]}${l.note ? ` (${l.note})` : ""}`,
        cost,
      });
    }
  }

  const cost = round2(costLines.reduce((s, l) => s + l.cost, 0));
  const priceExGst = Math.round(cost / (1 - marginPercent / 100));
  const gst = round2((priceExGst * settings.gst_percent) / 100);

  // Customer lines: one per scope item. Shared costs (trucks, crew, plant) are spread over the
  // items by their share of direct cost, then the margin. Rounded to dollars; the largest line
  // absorbs rounding so the lines add up to the price exactly.
  const shared = cost - [...direct.values()].reduce((s, v) => s + v, 0);
  const directTotal = [...direct.values()].reduce((s, v) => s + v, 0);
  const priced = scope.items.filter((i) => (direct.get(i.key) ?? 0) > 0);
  const customerLines: CustomerLine[] = priced.map((item) => {
    const d = direct.get(item.key) ?? 0;
    const share = directTotal > 0 ? d / directTotal : 1 / priced.length;
    const total = Math.round((d + shared * share) / (1 - marginPercent / 100));
    const ci = byId.get(item.cost_item_id!)!;
    const isArea = item.area_m2 && (item.kind !== "other" || ci.unit === "m2");
    const quantity = isArea ? item.area_m2! : item.quantity ?? 1;
    const unit = isArea ? "m²" : UNIT_LABEL[ci.unit];
    return { key: item.key, description: item.description, quantity, unit, rate: round2(total / quantity), total };
  });
  if (customerLines.length) {
    const diff = priceExGst - customerLines.reduce((s, l) => s + l.total, 0);
    const biggest = customerLines.reduce((a, b) => (b.total > a.total ? b : a));
    biggest.total += diff;
    biggest.rate = round2(biggest.total / biggest.quantity);
  } else if (priceExGst > 0) {
    customerLines.push({ key: "works", description: scope.title || "Works as described", quantity: 1, unit: "lot", rate: priceExGst, total: priceExGst });
  }

  return {
    costLines, customerLines, cost, marginPercent, priceExGst,
    profit: round2(priceExGst - cost), gst, priceIncGst: round2(priceExGst + gst),
    trucks, haul, warnings,
  };
}
