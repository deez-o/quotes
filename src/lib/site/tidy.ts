import type { ScopeItem } from "./price";

/** The order a crew does the work: dig out, base, prime, asphalt, then seal and the rest. */
const ORDER: Record<ScopeItem["kind"], number> = { excavation: 0, base: 1, prime: 2, asphalt: 3, seal: 4, other: 5 };

/**
 * One prime (or seal) line per product over the whole area it covers, and the lines in
 * the order the work is done: prime above the asphalt it goes under.
 */
export function tidyItems(items: ScopeItem[]): ScopeItem[] {
  const out: ScopeItem[] = [];
  for (const i of items) {
    const sprayed = i.kind === "prime" || i.kind === "seal";
    const same = sprayed && i.cost_item_id ? out.find((o) => o.kind === i.kind && o.cost_item_id === i.cost_item_id) : undefined;
    if (same) {
      same.area_m2 = (same.area_m2 ?? 0) + (i.area_m2 ?? 0) || null;
      if (i.description && same.description !== i.description) same.description = i.kind === "prime" ? "Prime" : "Seal";
    } else out.push({ ...i });
  }
  return out.map((i, n) => ({ i, n })).sort((a, b) => ORDER[a.i.kind] - ORDER[b.i.kind] || a.n - b.n).map((x) => x.i);
}
