/**
 * Market numbers for the dashboard: where you win, which mixes, at what margin and size.
 * Worked out in code from each quote's saved pricing. Pure, so it can be tested.
 * "Win rate" is won ÷ (won + lost): quotes still waiting don't count either way.
 */
export type MarketQuote = {
  id: string; status: string; created_at: string; site_address: string | null; total_ex_gst: number | null;
  costing: {
    marginPercent?: number; priceExGst?: number; cost?: number;
    perTonne?: { tonnes: number; price: number; profit: number } | null;
    customerLines?: { key: string; quantity: number; unit: string; rate: number; total: number }[];
  } | null;
  scope: { items?: { key: string; kind: string; cost_item_id: string | null }[] } | null;
};

type Tally = { quotes: number; won: number; lost: number; wonValue: number; marginWonSum: number; marginWonN: number };
const tally = (): Tally => ({ quotes: 0, won: 0, lost: 0, wonValue: 0, marginWonSum: 0, marginWonN: 0 });
const rate = (t: { won: number; lost: number }) => (t.won + t.lost ? t.won / (t.won + t.lost) : null);

export type AreaRow = { area: string; quotes: number; won: number; lost: number; winRate: number | null; wonValue: number; marginWon: number | null };
export type MixRow = { mix: string; tonnesQuoted: number; tonnesWon: number; quotes: number; won: number; lost: number; winRate: number | null; rateQuoted: number | null; rateWon: number | null; rateLost: number | null };
export type BandRow = { band: string; quotes: number; won: number; lost: number; winRate: number | null };

export type Market = {
  decided: number;
  tonnesQuoted: number; tonnesWon: number;
  marginWon: number | null; marginLost: number | null;
  perTonneWon: number | null; perTonneLost: number | null;
  areas: AreaRow[]; mixes: MixRow[]; margins: BandRow[]; sizes: BandRow[];
};

/** "12 Main St, Yamanto QLD 4305" → "Yamanto". */
export function suburbOf(address: string | null): string | null {
  const a = (address ?? "").trim();
  if (!a) return null;
  const m = a.match(/(?:^|,)\s*([A-Za-z][A-Za-z' .-]*?)\s+(?:QLD|NSW|VIC|SA|WA|TAS|NT|ACT)\b/i);
  const raw = m ? m[1] : a.split(",").map((s) => s.trim()).filter(Boolean).pop() ?? "";
  const words = raw.replace(/\s+\d{4}$/, "").split(/\s+/).filter((w) => !/^\d/.test(w));
  const name = words.join(" ").trim();
  return name ? name.replace(/\b\w/g, (c) => c.toUpperCase()).replace(/\B\w+/g, (w) => w.toLowerCase()) : null;
}

const MARGIN_BANDS = [{ band: "Under 10%", max: 10 }, { band: "10–15%", max: 15 }, { band: "15–20%", max: 20 }, { band: "20% and over", max: Infinity }];
const SIZE_BANDS = [{ band: "Under 100 t", max: 100 }, { band: "100–300 t", max: 300 }, { band: "300–1,000 t", max: 1000 }, { band: "1,000 t and over", max: Infinity }];

export function market(rows: MarketQuote[], mixName: (costItemId: string) => string | null): Market {
  const areas = new Map<string, Tally>();
  const mixes = new Map<string, { t: Tally; tq: number; tw: number; sq: number; sw: number; sl: number; tl: number }>();
  const margins = MARGIN_BANDS.map((b) => ({ ...b, t: tally() }));
  const sizes = SIZE_BANDS.map((b) => ({ ...b, t: tally() }));
  let tonnesQuoted = 0, tonnesWon = 0, decided = 0;
  const mw: number[] = [], ml: number[] = [];
  let ptwSell = 0, ptwT = 0, ptlSell = 0, ptlT = 0;

  const add = (t: Tally, status: string, value: number, margin: number | null) => {
    t.quotes++;
    if (status === "won") { t.won++; t.wonValue += value; if (margin != null) { t.marginWonSum += margin; t.marginWonN++; } }
    if (status === "lost") t.lost++;
  };

  for (const q of rows) {
    const c = q.costing ?? {};
    const value = Number(c.priceExGst ?? q.total_ex_gst ?? 0);
    if (!(value > 0)) continue; // never priced: nothing to learn from
    const margin = typeof c.marginPercent === "number" ? c.marginPercent : null;
    const won = q.status === "won", lost = q.status === "lost";
    if (won || lost) decided++;
    if (won && margin != null) mw.push(margin);
    if (lost && margin != null) ml.push(margin);

    const area = suburbOf(q.site_address);
    if (area) { const t = areas.get(area) ?? tally(); add(t, q.status, value, margin); areas.set(area, t); }
    if (margin != null) add(margins.find((b) => margin < b.max)!.t, q.status, value, margin);

    // Asphalt by mix: the customer's per-tonne lines, matched back to the mix in the library.
    const kindOf = new Map((q.scope?.items ?? []).map((i) => [i.key, i]));
    let jobTonnes = 0;
    for (const l of c.customerLines ?? []) {
      const item = kindOf.get(l.key);
      if (l.unit !== "t" || !item || item.kind !== "asphalt" || !item.cost_item_id) continue;
      const mix = mixName(item.cost_item_id) ?? "Other mix";
      const m = mixes.get(mix) ?? { t: tally(), tq: 0, tw: 0, sq: 0, sw: 0, sl: 0, tl: 0 };
      m.tq += l.quantity; m.sq += l.total;
      if (won) { m.tw += l.quantity; m.sw += l.total; }
      if (lost) { m.tl += l.quantity; m.sl += l.total; }
      mixes.set(mix, m);
      jobTonnes += l.quantity;
    }
    // Count each quote once per mix it has.
    for (const mix of new Set((c.customerLines ?? []).map((l) => kindOf.get(l.key)).filter((i) => i?.kind === "asphalt" && i.cost_item_id).map((i) => mixName(i!.cost_item_id!) ?? "Other mix"))) {
      add(mixes.get(mix)!.t, q.status, value, margin);
    }
    tonnesQuoted += jobTonnes;
    if (won) tonnesWon += jobTonnes;
    if (jobTonnes > 0) add(sizes.find((b) => jobTonnes < b.max)!.t, q.status, value, margin);
    const pt = c.perTonne;
    if (pt && pt.tonnes > 0) {
      if (won) { ptwSell += pt.price * pt.tonnes; ptwT += pt.tonnes; }
      if (lost) { ptlSell += pt.price * pt.tonnes; ptlT += pt.tonnes; }
    }
  }

  const avg = (a: number[]) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
  const band = (b: { band: string; t: Tally }): BandRow => ({ band: b.band, quotes: b.t.quotes, won: b.t.won, lost: b.t.lost, winRate: rate(b.t) });
  return {
    decided, tonnesQuoted, tonnesWon,
    marginWon: avg(mw), marginLost: avg(ml),
    perTonneWon: ptwT ? ptwSell / ptwT : null, perTonneLost: ptlT ? ptlSell / ptlT : null,
    areas: [...areas].map(([area, t]) => ({ area, quotes: t.quotes, won: t.won, lost: t.lost, winRate: rate(t), wonValue: t.wonValue, marginWon: t.marginWonN ? t.marginWonSum / t.marginWonN : null }))
      .sort((a, b) => b.wonValue - a.wonValue || b.quotes - a.quotes).slice(0, 12),
    mixes: [...mixes].map(([mix, m]) => ({
      mix, tonnesQuoted: m.tq, tonnesWon: m.tw, quotes: m.t.quotes, won: m.t.won, lost: m.t.lost, winRate: rate(m.t),
      rateQuoted: m.tq ? m.sq / m.tq : null, rateWon: m.tw ? m.sw / m.tw : null, rateLost: m.tl ? m.sl / m.tl : null,
    })).sort((a, b) => b.tonnesQuoted - a.tonnesQuoted),
    margins: margins.map(band), sizes: sizes.map(band),
  };
}
