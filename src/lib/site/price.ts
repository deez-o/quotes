import { WORK_ORDER } from "./tidy";
/**
 * Site-quote pricing: plain code, never the AI. Turns a scope (what was said
 * on site, as checked by the user) plus the customer's costs library into
 * costs, a price at their margin, and clean customer line items.
 * Every number carries its working so the user can see how it was reached.
 * Pure functions: runs on the server and live in the phone browser.
 */
import { binderExtraFor, binderLabel, type BinderSetup } from "@/lib/binder";
import { ownBinder } from "@/lib/mixes";

export type CostItem = {
  id: string;
  category: "crew" | "material" | "plant" | "truck" | "float" | "establishment" | "other";
  material_kind: "asphalt" | "base" | "prime" | "tack" | "seal" | "other" | null;
  /** A fixed price per unit on the quote (no margin spread), e.g. tack coat always at $3/m². */
  sell_rate?: number | null;
  name: string;
  unit: "shift" | "day" | "h" | "t" | "m2" | "m3" | "each" | "km";
  rate: number;
  density_t_per_m3: number | null;
  includes_delivery: boolean;
  truck_capacity_t: number | null;
  active: boolean;
  /** Set for a mix priced at one supply plant; null for general costs. */
  supply_plant_id?: string | null;
  /** Hourly crew with overtime: ordinary hours a day, then ot1_hours at ot1_multiplier, then ot2_multiplier. */
  ordinary_hours?: number | null;
  ot1_hours?: number | null;
  ot1_multiplier?: number | null;
  ot2_multiplier?: number | null;
  /** Sliding scale by quantity: the whole quantity is priced at its band's rate; above the last break, `rate`. */
  rate_tiers?: { up_to: number; rate: number }[] | null;
  /** Minimum hire: charged for at least this many hours a day (trucks, bobcats, crew). */
  min_hours?: number | null;
};

export type SupplyPlant = { id: string; name: string; lat: number | null; lng: number | null };

export type ScopeItemKind = "asphalt" | "base" | "prime" | "tack" | "seal" | "excavation" | "other";

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
  /** Asphalt: the binder asked for (C320, C600, A15E...). Null = the company default. */
  binder?: string | null;
};

/** amount: per day, in the cost item's unit (hours, shifts...). days: how many days (1 if not set). */
export type LabourLine = { key: string; cost_item_id: string; amount: number; days?: number | null; note: string | null };

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
  /** Set by the user when the GPS estimate is wrong (one-way). */
  haul_override?: { km: number; minutes: number } | null;
  /** Float moves (paver and roller to site and back). Null = automatic: 1 when the job has asphalt. */
  float_moves?: number | null;
  /** From the plans: how much of a normal day's m² a crew lays here (1 = straight, open work). */
  paving_factor?: number;
  /** Set-ups on site the job needs (e.g. one for the prime and one per asphalt layer). Null = 1 when there's work. */
  establishments?: number | null;
  /** Rates the customer asked for that aren't in the price (extra establishment, MTV if needed). */
  optional_rates?: { key: string; cost_item_id: string; description: string; quantity?: number | null; custom_rate?: number | null; custom_unit?: string | null }[];
  /** The job's address or suburb as they said it (the AI hears it); used instead of the phone's location. */
  site_location?: string | null;
  /** True when the plant was picked as the nearest one (re-picked if the site moves); false once the user chooses. */
  supply_plant_auto?: boolean;
  /** From an RFQ: who's asking (company), and their email if given. */
  customer_name?: string | null;
  customer_email?: string | null;
};

/** Road distance and truck time from the site to one plant, worked out when the site was located. */
export type RouteHaul = { km: number; minutes: number; source: "google" | "osm" };
export type HaulRoutes = Record<string, RouteHaul>;

export type PricingSettings = {
  truck_load_minutes: number;
  truck_unload_minutes: number;
  shift_minutes: number;
  road_factor: number;
  average_speed_kmh: number;
  gst_percent: number;
  /** Plant base binders and extra-overs. Absent = no binder extras. */
  binders?: BinderSetup;
  /** m² a crew lays in a day by job type and haul (sets crew shifts on drafts). */
  crewOutput?: import("./crew-days").CrewOutput;
  /** Their yard or depot: crew travel time to the job is worked out from here. */
  base?: { lat: number; lng: number } | null;
};

export type Haul = { km: number; minutes: number; source: "gps" | "entered" | "road" };

/** The numbers behind a cost line, for the Excel workings (formulas rebuilt from these). */
export type CostCalc =
  | { kind: "tonnes"; area_m2: number; depth_mm: number; density: number; tonnes: number; rate: number; unit: string; band: string | null; delivered: boolean }
  | { kind: "volume"; area_m2: number | null; depth_mm: number | null; qty: number; rate: number; unit: string; band: string | null }
  | { kind: "qty"; qty: number; rate: number; unit: string; band: string | null }
  | { kind: "trucks"; tonnes: number; capacity: number; loads: number; minutesEachWay: number; km: number; loadMinutes: number; unloadMinutes: number; cycleMinutes: number; hours: number; trucks: number; basis: "h" | "km" | "truck"; rate: number }
  | { kind: "time"; days: number; amount: number; unit: string; rate: number; parts: { hours: number; rate: number }[] | null };

export type CostLine = {
  key: string;
  group: "material" | "trucks" | "crew" | "plant" | "other";
  label: string;
  working: string;
  cost: number;
  calc?: CostCalc;
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
  /** Asphalt by the tonne: what it costs us and what we sell it for (supply and lay), shared costs included. */
  perTonne: { tonnes: number; cost: number; price: number; profit: number } | null;
  /** Crew shifts priced (cost items charged per shift), and profit per shift. */
  shifts: number;
  profitPerShift: number | null;
  /** Rate-only lines shown on the quote, not added to the total: the cost rate with the margin on. */
  optionalRates: { key: string; description: string; unit: string; rate: number; quantity?: number | null; total?: number | null }[];
};

const round2 = (n: number) => Math.round(n * 100) / 100;
const fmtN = (n: number, dp = 1) => Number(n.toFixed(dp)).toLocaleString("en-AU");
export const money = (n: number) =>
  `$${n.toLocaleString("en-AU", { minimumFractionDigits: n % 1 === 0 ? 0 : 2, maximumFractionDigits: n % 1 === 0 ? 0 : 2 })}`;

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

/**
 * When the supply plant changes, swap each mix for the same-named mix at the new plant
 * (each plant has its own prices). Items with no match stay put and get flagged when priced.
 */
export function alignToPlant(scope: SiteScope, library: CostItem[], plantId: string | null): SiteScope {
  if (!plantId) return { ...scope, supply_plant_id: null };
  const byId = new Map(library.map((c) => [c.id, c]));
  const atPlant = library.filter((c) => c.active && c.supply_plant_id === plantId);
  const items = scope.items.map((i) => {
    const ci = i.cost_item_id ? byId.get(i.cost_item_id) : undefined;
    if (!ci?.supply_plant_id || ci.supply_plant_id === plantId) return i;
    const twin = atPlant.find((c) => c.name.trim().toLowerCase() === ci.name.trim().toLowerCase());
    return twin ? { ...i, cost_item_id: twin.id } : i;
  });
  return { ...scope, items, supply_plant_id: plantId };
}

/**
 * The supply plant for a job when nobody named one: the nearest plant (road distance where known,
 * else straight line × road factor) that sells every plant-priced mix on the job; if none sells
 * them all, the nearest plant. Then mixes are swapped to that plant's prices.
 */
export function choosePlant(input: {
  scope: SiteScope; library: CostItem[]; plants: SupplyPlant[]; settings: PricingSettings;
  site: { lat: number | null; lng: number | null }; routes?: HaulRoutes | null;
}): SiteScope {
  const { scope, library, plants, settings, site, routes } = input;
  const byId = new Map(library.map((c) => [c.id, c]));
  const distance = (p: SupplyPlant): number | null => {
    const r = routes?.[p.id];
    if (r) return r.km;
    if (site.lat == null || site.lng == null || p.lat == null || p.lng == null) return null;
    return haversineKm(site.lat, site.lng, p.lat, p.lng) * settings.road_factor;
  };
  const ranked = plants.map((p) => ({ p, km: distance(p) })).filter((x): x is { p: SupplyPlant; km: number } => x.km != null).sort((a, b) => a.km - b.km);
  const mixNames = [...new Set(scope.items.map((i) => byId.get(i.cost_item_id ?? "")).filter((c) => c?.supply_plant_id).map((c) => c!.name.trim().toLowerCase()))];
  const sells = (plantId: string) => mixNames.every((n) => library.some((c) => c.active && c.supply_plant_id === plantId && c.name.trim().toLowerCase() === n));

  let pick: string | null = ranked.find((x) => sells(x.p.id))?.p.id ?? ranked[0]?.p.id ?? null;
  if (!pick) {
    // No site location: fall back to the plant the mixes come from, or the only plant.
    const fromMixes = new Set(scope.items.map((i) => byId.get(i.cost_item_id ?? "")?.supply_plant_id).filter((x): x is string => !!x && plants.some((p) => p.id === x)));
    pick = fromMixes.size === 1 ? [...fromMixes][0] : plants.length === 1 ? plants[0].id : null;
  }
  return { ...alignToPlant(scope, library, pick), supply_plant_auto: pick != null };
}

/** Cost of one day's hours with overtime: ordinary, then time-and-a-half, then double time (by default). */
export function overtimeDay(ci: CostItem, hours: number): { cost: number; parts: { hours: number; rate: number }[] } {
  const ord = ci.ordinary_hours ?? Infinity;
  const ot1h = ci.ot1_hours ?? 2;
  const m1 = ci.ot1_multiplier ?? 1.5;
  const m2 = ci.ot2_multiplier ?? 2;
  const a = Math.min(hours, ord);
  const b = Math.min(Math.max(hours - ord, 0), ot1h);
  const c = Math.max(hours - ord - ot1h, 0);
  const parts = [{ hours: a, rate: ci.rate }, { hours: b, rate: round2(ci.rate * m1) }, { hours: c, rate: round2(ci.rate * m2) }].filter((p) => p.hours > 0);
  return { cost: round2(parts.reduce((s, p) => s + p.hours * p.rate, 0)), parts };
}

/** The rate for a quantity on a sliding scale, and which band it came from. */
export function rateFor(ci: CostItem, qty: number): { rate: number; band: string | null } {
  const tiers = (ci.rate_tiers ?? []).filter((t) => t.up_to > 0 && t.rate >= 0).sort((a, b) => a.up_to - b.up_to);
  if (!tiers.length) return { rate: ci.rate, band: null };
  const u = UNIT_LABEL[ci.unit];
  let from = 0;
  for (const t of tiers) {
    if (qty <= t.up_to) return { rate: t.rate, band: `${fmtN(from, 0)}–${fmtN(t.up_to, 0)} ${u} rate` };
    from = t.up_to;
  }
  return { rate: ci.rate, band: `over ${fmtN(from, 0)} ${u} rate` };
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
  const itemTonnes = new Map<string, number>();
  let truckTonnes = 0;

  for (const item of scope.items) {
    const ci = item.cost_item_id ? byId.get(item.cost_item_id) : undefined;
    if (!ci) {
      warnings.push(`"${item.description}" has no matching cost in your library, so it isn't priced.`);
      direct.set(item.key, 0);
      continue;
    }
    // A mix added from the state list but not priced yet: never quote it at $0.
    if (!(ci.rate > 0) && ci.sell_rate == null && !ci.rate_tiers?.length) {
      warnings.push(`${ci.name} has no price yet. Add it in Your costs${ci.supply_plant_id ? ", at the plant" : ""}.`);
      direct.set(item.key, 0);
      continue;
    }
    if (ci.supply_plant_id && scope.supply_plant_id && ci.supply_plant_id !== scope.supply_plant_id) {
      warnings.push(`${ci.name} is priced at a different plant from the one chosen for this job.`);
    }
    let qty = 0;
    let working = "";
    let tonnes = 0;
    let rate = ci.rate;
    let calc: CostCalc | undefined;

    if ((item.kind === "asphalt" || item.kind === "base") && ci.unit === "t") {
      if (!item.area_m2 || !item.depth_mm) {
        warnings.push(`"${item.description}" needs an area and a depth.`);
      } else if (!ci.density_t_per_m3) {
        warnings.push(`${ci.name} has no density in your library, so tonnes can't be worked out.`);
      } else {
        tonnes = tonnesFor(item.area_m2, item.depth_mm, ci.density_t_per_m3);
        qty = tonnes;
        itemTonnes.set(item.key, tonnes);
        const r = rateFor(ci, tonnes);
        rate = r.rate;
        let binderNote = "";
        // EME2 is its own mix with its own binder, priced as a whole: never a binder extra-over.
        if (item.kind === "asphalt" && !ownBinder(ci.name)) {
          const b = binderExtraFor(settings.binders, ci.supply_plant_id, ci.name, item.binder ?? settings.binders?.defaultBinder);
          if (b.kind === "extra") {
            rate = round2(rate + b.extra);
            binderNote = ` (${money(r.rate)} + ${money(b.extra)} extra for ${binderLabel(b.binder)})`;
          } else if (b.kind === "missing") {
            warnings.push(`${ci.name}: no extra-over price for ${binderLabel(b.binder)} at this plant, so it's priced at ${binderLabel(b.base)}. Add it under Costs, at the plant.`);
          }
        }
        working = `${fmtN(item.area_m2, 0)} m² × ${item.depth_mm / 1000} m × ${ci.density_t_per_m3} t/m³ = ${fmtN(tonnes)} t × ${money(rate)}/t${binderNote}${r.band ? ` (${r.band})` : ""}`;
        calc = { kind: "tonnes", area_m2: item.area_m2, depth_mm: item.depth_mm, density: ci.density_t_per_m3, tonnes, rate, unit: "t", band: r.band, delivered: ci.includes_delivery };
        if (!ci.includes_delivery) truckTonnes += tonnes;
      }
    } else if (ci.unit === "m3") {
      const m3 = item.quantity ?? (item.area_m2 && item.depth_mm ? round2(item.area_m2 * (item.depth_mm / 1000)) : 0);
      qty = m3;
      const r = rateFor(ci, m3);
      rate = r.rate;
      const band = r.band ? ` (${r.band})` : "";
      working = item.quantity ? `${fmtN(m3)} m³ × ${money(rate)}/m³${band}` : `${fmtN(item.area_m2 ?? 0, 0)} m² × ${(item.depth_mm ?? 0) / 1000} m = ${fmtN(m3)} m³ × ${money(rate)}/m³${band}`;
      calc = { kind: "volume", area_m2: item.quantity ? null : item.area_m2, depth_mm: item.quantity ? null : item.depth_mm, qty: m3, rate, unit: "m³", band: r.band };
      if (!m3) warnings.push(`"${item.description}" needs a volume, or an area and a depth.`);
    } else if (ci.unit === "m2") {
      qty = item.area_m2 ?? item.quantity ?? 0;
      const r = rateFor(ci, qty);
      rate = r.rate;
      working = `${fmtN(qty, 0)} m² × ${money(rate)}/m²${r.band ? ` (${r.band})` : ""}`;
      calc = { kind: "qty", qty, rate, unit: "m²", band: r.band };
      if (!qty) warnings.push(`"${item.description}" needs an area.`);
    } else {
      qty = item.quantity ?? 0;
      const r = rateFor(ci, qty);
      rate = r.rate;
      working = `${fmtN(qty)} ${UNIT_LABEL[ci.unit]} × ${money(rate)}/${UNIT_LABEL[ci.unit]}${r.band ? ` (${r.band})` : ""}`;
      calc = { kind: "qty", qty, rate, unit: UNIT_LABEL[ci.unit], band: r.band };
      if (!qty) warnings.push(`"${item.description}" needs a quantity.`);
    }

    const cost = round2(qty * rate);
    direct.set(item.key, cost);
    costLines.push({ key: item.key, group: "material", label: item.description, working, cost, calc });
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
      const workHours = round2((loads * cycle) / 60);
      const trucksNeeded = Math.min(loads, Math.max(1, Math.ceil((loads * cycle) / settings.shift_minutes)));
      // Minimum hire: each truck is paid for at least its minimum hours.
      const minHours = truck.unit === "h" && truck.min_hours ? truck.min_hours * trucksNeeded : 0;
      const hours = Math.max(workHours, minHours);
      const rateUnit = truck.unit === "h" ? hours : truck.unit === "km" ? loads * 2 * haul.km : truck.unit === "each" || truck.unit === "day" ? trucksNeeded : hours;
      const cost = round2(rateUnit * truck.rate);
      trucks = { loads, trucks: trucksNeeded, cycleMinutes: cycle, hours, tonnes: round2(truckTonnes) };
      costLines.push({
        key: "trucks",
        group: "trucks",
        label: `Cartage from plant (${trucksNeeded} truck${trucksNeeded === 1 ? "" : "s"})`,
        working: `${fmtN(truckTonnes)} t ÷ ${capacity} t = ${loads} loads × ${cycle} min cycle (${haul.minutes} min each way + load/unload) = ${fmtN(workHours, 2)} h${hours > workHours ? `, charged ${fmtN(hours, 2)} h (${fmtN(truck.min_hours!)} h minimum a truck)` : ""} × ${money(truck.rate)}/h`,
        cost,
        calc: {
          kind: "trucks", tonnes: round2(truckTonnes), capacity, loads, minutesEachWay: haul.minutes, km: haul.km,
          loadMinutes: settings.truck_load_minutes, unloadMinutes: settings.truck_unload_minutes, cycleMinutes: cycle, hours, trucks: trucksNeeded,
          basis: truck.unit === "km" ? "km" : truck.unit === "each" || truck.unit === "day" ? "truck" : "h", rate: truck.rate,
        },
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
      const days = l.days && l.days > 0 ? l.days : 1;
      if (!l.amount || l.amount <= 0) {
        warnings.push(`${ci.name}: how many ${ci.unit === "h" ? "hours a day" : UNIT_LABEL[ci.unit] + "s"}?`);
        continue;
      }
      const dayPrefix = days !== 1 ? `${fmtN(days)} days × ` : "";
      // Minimum hire a day (hourly only): a 2-hour bobcat job still pays the 6-hour minimum.
      const charged = ci.unit === "h" && ci.min_hours && l.amount < ci.min_hours ? ci.min_hours : l.amount;
      const note = `${charged > l.amount ? ` (${fmtN(l.amount)} h needed, ${fmtN(charged)} h minimum)` : ""}${l.note ? ` (${l.note})` : ""}`;
      if (ci.unit === "h" && ci.ordinary_hours) {
        const day = overtimeDay(ci, charged);
        const parts = day.parts.map((p) => `${fmtN(p.hours)} h × ${money(p.rate)}`).join(" + ");
        costLines.push({
          key: l.key, group, label: ci.name, cost: round2(day.cost * days),
          calc: { kind: "time", days, amount: charged, unit: "h", rate: ci.rate, parts: day.parts },
          working: `${dayPrefix}${days !== 1 || day.parts.length > 1 ? `(${parts})` : parts}${day.parts.length > 1 ? ` (overtime after ${fmtN(ci.ordinary_hours)} h)` : ""}${note}`,
        });
      } else {
        costLines.push({
          key: l.key, group, label: ci.name, cost: round2(charged * days * ci.rate),
          calc: { kind: "time", days, amount: charged, unit: UNIT_LABEL[ci.unit], rate: ci.rate, parts: null },
          working: `${dayPrefix}${fmtN(charged)} ${UNIT_LABEL[ci.unit]} × ${money(ci.rate)}/${UNIT_LABEL[ci.unit]}${note}`,
        });
      }
    }
  }

  // Float: a cost spread into the asphalt rate, never its own customer line. Asphalt establishments only.
  const hasAsphalt = scope.items.some((i) => i.kind === "asphalt");
  const floatItem = library.find((c) => c.category === "float" && c.active);
  const moves = scope.float_moves ?? (hasAsphalt ? 1 : 0);
  if (floatItem && moves > 0) {
    costLines.push({
      key: "float", group: "plant", label: floatItem.name, cost: round2(moves * floatItem.rate),
      calc: { kind: "qty", qty: moves, rate: floatItem.rate, unit: "move", band: null },
      working: `${fmtN(moves)} move${moves === 1 ? "" : "s"} × ${money(floatItem.rate)}${scope.float_moves == null ? " (one per asphalt job)" : ""}`,
    });
  }

  // Numbers that look mistyped: a stray digit can turn a $500k job into $100 million.
  for (const item of scope.items) {
    if (item.depth_mm != null && item.depth_mm > 300) warnings.push(`"${item.description}" is ${fmtN(item.depth_mm, 0)} mm deep. Check the depth (it's in millimetres).`);
    if (item.area_m2 != null && item.area_m2 > 200000) warnings.push(`"${item.description}" is ${fmtN(item.area_m2, 0)} m². Check the area.`);
  }
  for (const l of [...scope.crew, ...scope.plant]) {
    if (l.days != null && l.days > 60) warnings.push(`A crew or plant line runs ${fmtN(l.days, 0)} days. Check the days.`);
    const u = byId.get(l.cost_item_id)?.unit;
    if (u === "h" && l.amount > 24) warnings.push(`A crew or plant line has ${fmtN(l.amount, 0)} hours in a day. Check the hours.`);
  }

  // Establishment: one charge per set-up on site, its own line on the quote.
  const estItem = library.find((c) => c.category === "establishment" && c.active);
  const estCount = scope.establishments != null && scope.establishments > 0 ? Math.round(scope.establishments) : scope.items.length ? 1 : 0;
  const estCost = estItem && estCount > 0 ? round2(estCount * estItem.rate) : 0;
  if (estItem && estCost > 0) {
    costLines.push({
      key: "establishment", group: "plant", label: estItem.name, cost: estCost,
      calc: { kind: "qty", qty: estCount, rate: estItem.rate, unit: "each", band: null },
      working: `${estCount} × ${money(estItem.rate)}${scope.establishments == null ? " (one per job)" : ""}`,
    });
  }

  const cost = round2(costLines.reduce((s, l) => s + l.cost, 0));
  // Job lines listed but none of them priced (no areas, no matching mix): nothing to quote yet.
  // Don't turn a float or a crew day into a "1 lot" price that looks like a real quote.
  const unpriced = scope.items.length > 0 && ![...direct.values()].some((v) => v > 0);
  // Items with a fixed sell price (e.g. tack coat at $3/m²) go on at that price; the margin goes on the rest.
  const fixed = new Map<string, number>();
  for (const item of scope.items) {
    const ci = item.cost_item_id ? byId.get(item.cost_item_id) : undefined;
    if (ci?.sell_rate == null || !((direct.get(item.key) ?? 0) > 0)) continue;
    const q = itemTonnes.get(item.key) ?? (ci.unit === "m2" ? item.area_m2 : item.quantity) ?? 0;
    if (q > 0) fixed.set(item.key, Math.round(ci.sell_rate * q));
  }
  const fixedCost = [...fixed.keys()].reduce((s, k) => s + (direct.get(k) ?? 0), 0);
  const fixedSell = [...fixed.values()].reduce((s, v) => s + v, 0);
  const priceExGst = unpriced ? 0 : Math.round((cost - fixedCost) / (1 - marginPercent / 100)) + fixedSell;
  const gst = round2((priceExGst * settings.gst_percent) / 100);

  // Customer lines: one per scope item. Shared costs (trucks, crew, plant) are spread over the
  // items by their share of direct cost, then the margin. Rounded to dollars; the largest line
  // absorbs rounding so the lines add up to the price exactly.
  const shared = cost - estCost - [...direct.values()].reduce((s, v) => s + v, 0);
  const directTotal = [...direct.entries()].reduce((s, [k, v]) => s + (fixed.has(k) ? 0 : v), 0);
  const priced = scope.items.filter((i) => (direct.get(i.key) ?? 0) > 0);
  const spreadOver = priced.filter((i) => !fixed.has(i.key)).length || 1;
  const customerLines: CustomerLine[] = priced.map((item) => {
    const d = direct.get(item.key) ?? 0;
    const share = fixed.has(item.key) ? 0 : directTotal > 0 ? d / directTotal : 1 / spreadOver;
    const total = fixed.get(item.key) ?? Math.round((d + shared * share) / (1 - marginPercent / 100));
    const ci = byId.get(item.cost_item_id!)!;
    // Asphalt and base sold by the tonne go on the quote per tonne (supply and lay $/t).
    const t = itemTonnes.get(item.key);
    if (t) return { key: item.key, description: item.description, quantity: t, unit: "t", rate: round2(total / t), total };
    const isArea = item.area_m2 && (item.kind !== "other" || ci.unit === "m2");
    const quantity = isArea ? item.area_m2! : item.quantity ?? 1;
    const unit = isArea ? "m²" : UNIT_LABEL[ci.unit];
    return { key: item.key, description: item.description, quantity, unit, rate: round2(total / quantity), total };
  });
  if (estItem && estCost > 0 && !unpriced && customerLines.length) {
    const total = Math.round(estCost / (1 - marginPercent / 100));
    customerLines.push({ key: "establishment", description: estCount > 1 ? `${estItem.name} (${estCount} set-ups)` : estItem.name, quantity: estCount, unit: "each", rate: round2(total / estCount), total });
  }
  // Prime and seal go on the quote as one line over the whole area (same product), not one per layer.
  for (const kind of ["prime", "tack", "seal"] as const) {
    const keys = scope.items.filter((i) => i.kind === kind).map((i) => i.key);
    const lines = customerLines.filter((l) => keys.includes(l.key) && l.unit === "m²");
    const byCost = new Map<string, CustomerLine[]>();
    for (const l of lines) {
      const ci = scope.items.find((i) => i.key === l.key)!.cost_item_id ?? "";
      byCost.set(ci, [...(byCost.get(ci) ?? []), l]);
    }
    for (const group of byCost.values()) {
      if (group.length < 2) continue;
      const [first, ...rest] = group;
      first.quantity = round2(group.reduce((s, l) => s + l.quantity, 0));
      first.total = group.reduce((s, l) => s + l.total, 0);
      first.rate = round2(first.total / first.quantity);
      first.description = first.description.replace(/\s+(under|beneath|below|to|for)\s+.*$/i, "").trim() || first.description;
      for (const r of rest) customerLines.splice(customerLines.indexOf(r), 1);
    }
  }
  // The order the work is done, whatever order the lines were added in: prime always above the asphalt.
  const kindOf = new Map([["establishment", { k: -1, n: 0 }], ...scope.items.map((i, n) => [i.key, { k: WORK_ORDER[i.kind] ?? 9, n }] as [string, { k: number; n: number }])]);
  customerLines.sort((a, b) => (kindOf.get(a.key)?.k ?? 9) - (kindOf.get(b.key)?.k ?? 9) || (kindOf.get(a.key)?.n ?? 0) - (kindOf.get(b.key)?.n ?? 0));
  if (customerLines.length) {
    const diff = priceExGst - customerLines.reduce((s, l) => s + l.total, 0);
    const flex = customerLines.filter((l) => !fixed.has(l.key));
    const biggest = (flex.length ? flex : customerLines).reduce((a, b) => (b.total > a.total ? b : a));
    biggest.total += diff;
    biggest.rate = round2(biggest.total / biggest.quantity);
  } else if (priceExGst > 0) {
    customerLines.push({ key: "works", description: scope.title || "Works as described", quantity: 1, unit: "lot", rate: priceExGst, total: priceExGst });
  }

  // Asphalt per tonne, with its share of trucks, crew and plant.
  const asphaltKeys = scope.items.filter((i) => i.kind === "asphalt" && itemTonnes.get(i.key)).map((i) => i.key);
  const asphaltT = asphaltKeys.reduce((s, k) => s + (itemTonnes.get(k) ?? 0), 0);
  let perTonne: Priced["perTonne"] = null;
  if (asphaltT > 0) {
    const costShare = asphaltKeys.reduce((s, k) => {
      const d = direct.get(k) ?? 0;
      return s + d + (directTotal > 0 ? shared * (d / directTotal) : 0);
    }, 0);
    const sell = customerLines.filter((l) => asphaltKeys.includes(l.key)).reduce((s, l) => s + l.total, 0);
    perTonne = { tonnes: round2(asphaltT), cost: round2(costShare / asphaltT), price: round2(sell / asphaltT), profit: round2((sell - costShare) / asphaltT) };
  }
  // Shifts: per-shift crew counts its shifts; hourly or daily crew counts its days.
  const shifts = scope.crew.reduce((s, l) => {
    const u = byId.get(l.cost_item_id)?.unit;
    const days = l.days && l.days > 0 ? l.days : 1;
    return s + (u === "shift" ? l.amount * days : u === "h" || u === "day" ? (l.amount > 0 ? days : 0) : 0);
  }, 0);
  const profit = round2(priceExGst - cost);

  // Rates asked for but not in the price: the cost rate with the same margin on.
  const optionalRates = (scope.optional_rates ?? []).flatMap((o) => {
    const q = o.quantity != null && o.quantity > 0 ? o.quantity : null;
    // Their own rate, typed in: shown as typed (it's already the price).
    if (o.custom_rate != null && o.custom_rate >= 0) {
      const unit = (o.custom_unit || "each").slice(0, 20);
      return [{ key: o.key, description: o.description || "Rate", unit, rate: o.custom_rate, quantity: q, total: q ? Math.round(o.custom_rate * q) : null }];
    }
    const ci = byId.get(o.cost_item_id);
    if (!ci || !ci.active) return [];
    const rate = ci.sell_rate ?? (ci.rate < 50 ? round2(ci.rate / (1 - marginPercent / 100)) : Math.round(ci.rate / (1 - marginPercent / 100)));
    // A quantity makes it a lump sum (e.g. profiling 7,002 m² at the m² rate).
    return [{ key: o.key, description: o.description || ci.name, unit: UNIT_LABEL[ci.unit], rate, quantity: q, total: q ? Math.round(rate * q) : null }];
  });

  return {
    optionalRates,
    costLines, customerLines, cost, marginPercent, priceExGst,
    profit, gst, priceIncGst: round2(priceExGst + gst),
    trucks, haul, warnings, perTonne, shifts, profitPerShift: shifts > 0 ? round2(profit / shifts) : null,
  };
}
