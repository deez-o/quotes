import { ADD_MIX, hasMix, knownMix } from "@/lib/mixes";
import type { CostItem, SiteScope } from "./price";

/** A mix the quote asked them to add, now in their costs: price the lines with it and drop the ask. */
export function fillAddedMixes(scope: SiteScope, library: CostItem[]): SiteScope {
  const mixes = library.filter((c) => c.active && c.category === "material" && c.material_kind === "asphalt");
  const added = new Set<string>();
  const items = scope.items.map((i) => {
    if (i.kind !== "asphalt" || i.cost_item_id) return i;
    const m = knownMix(i.description);
    const hit = m ? mixes.find((c) => hasMix([c.name], m)) : undefined;
    if (!hit) return i;
    added.add(m!);
    return { ...i, cost_item_id: hit.id };
  });
  // Crew with no hours a day yet: a 10-hour day.
  const crew = scope.crew.map((l) => (l.amount > 0 ? l : { ...l, amount: library.find((c) => c.id === l.cost_item_id)?.unit === "h" ? 10 : 1 }));
  if (!added.size) return { ...scope, crew };
  return { ...scope, crew, items, questions: scope.questions.filter((q) => !(q.startsWith(ADD_MIX) && added.has(q.slice(ADD_MIX.length).trim()))) };
}
