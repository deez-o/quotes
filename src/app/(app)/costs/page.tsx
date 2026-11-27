import { keyFor, liveModel } from "@/lib/ai/call";
import Link from "next/link";
import { requireTenant } from "@/lib/tenant";
import { createClient } from "@/lib/supabase/server";
import { archiveCostItem, saveCostItem, savePricingSettings } from "./actions";
import { PlantForm } from "./plant-form";
import { DEFAULT_TERMS } from "@/lib/site/terms";
import { PriceListUpload } from "./price-list";

type Item = {
  id: string; category: string; material_kind: string | null; name: string; unit: string; rate: number;
  density_t_per_m3: number | null; includes_delivery: boolean; truck_capacity_t: number | null; supply_plant_id: string | null;
  ordinary_hours: number | null; ot1_hours: number | null; ot1_multiplier: number | null; ot2_multiplier: number | null;
  rate_tiers: { up_to: number; rate: number }[] | null;
};
type Plant = { id: string; name: string; address: string | null; lat: number | null; lng: number | null; prices_valid_until: string | null; prices_note: string | null };

type Section = { key: string; category: string; title: string; hint: string; kinds?: [string, string][]; match: (i: Item) => boolean };

const SECTIONS: Section[] = [
  { key: "crew", category: "crew", title: "Crew", hint: "Per hour, with overtime. Normal hrs at the rate, then OT hrs at OT × the rate, then the rest at Then ×. E.g. $1,200 an hour, 8 normal hours, 2 at 1.5×, then 2×.", match: (i) => i.category === "crew" },
  { key: "material", category: "material", title: "Materials", hint: "Base, crushed rock and other materials. Sold by the tonne? Add a density so tonnes are worked out from area and depth.", kinds: [["base", "Base"], ["other", "Other"]],
    match: (i) => i.category === "material" && !i.supply_plant_id && !["asphalt", "seal", "prime"].includes(i.material_kind ?? "") },
  { key: "seal", category: "material", title: "Seal and prime", hint: "Per m². Use a sliding scale when the rate depends on job size.", kinds: [["seal", "Seal"], ["prime", "Prime"]],
    match: (i) => i.category === "material" && !i.supply_plant_id && ["seal", "prime"].includes(i.material_kind ?? "") },
];
const AFTER_ASPHALT: Section[] = [
  { key: "plant", category: "plant", title: "Plant and hire", hint: "Bobcat, profiler, roller and so on.", match: (i) => i.category === "plant" },
  { key: "truck", category: "truck", title: "Trucks", hint: "Used for cartage from the supply plant.", match: (i) => i.category === "truck" },
  { key: "float", category: "float", title: "Float", hint: "Moving the paver and roller to site, per move. Added to every asphalt job as a cost and built into the asphalt rate; it isn't its own line on the quote.", match: (i) => i.category === "float" },
  { key: "other", category: "other", title: "Other", hint: "Anything else you charge.", match: (i) => i.category === "other" },
];
const UNITS = [["shift", "shift"], ["day", "day"], ["h", "hour"], ["t", "tonne"], ["m2", "m²"], ["m3", "m³"], ["each", "each"], ["km", "km"]];

const grid: React.CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))", gap: 10, alignItems: "end" };
const field: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 4, fontSize: 13 };
const sel: React.CSSProperties = { font: "inherit", padding: 10, borderRadius: 8, border: "1px solid #b6bcc4", background: "#fff", width: "100%" };
const ACTIONS_COL = "160px";

/** Columns for a section: one heading row, then one line per cost. */
function columns(category: string, kinds?: [string, string][], plantId?: string): { heads: string[]; template: string } {
  const base = ["Name", "Rate (ex GST)", "Per"];
  const t = ["minmax(160px, 1fr)", "104px", "104px"];
  if (category === "crew" || category === "plant") {
    base.push("Normal hrs", "OT hrs", "OT ×", "Then ×");
    t.push("78px", "64px", "64px", "64px");
  } else if (category === "material") {
    if (kinds && !plantId) { base.push("Type"); t.push("110px"); }
    base.push("t/m³"); t.push("72px");
  } else if (category === "truck") {
    base.push("Carries (t)"); t.push("84px");
  }
  return { heads: [...base, ""], template: [...t, ACTIONS_COL].join(" ") };
}

function HeadRow({ category, kinds, plantId }: { category: string; kinds?: [string, string][]; plantId?: string }) {
  const c = columns(category, kinds, plantId);
  return (
    <div aria-hidden="true" style={{ display: "grid", gridTemplateColumns: c.template, gap: 10, padding: "10px 0 6px", fontSize: 12, fontWeight: 600, color: "var(--muted)" }}>
      {c.heads.map((h, i) => <span key={i}>{h}</span>)}
    </div>
  );
}

function ItemForm({ item, category, canEdit, plantId, kinds, unitDefault }: {
  item?: Item; category: string; canEdit: boolean; plantId?: string; kinds?: [string, string][]; unitDefault?: string;
}) {
  const isMaterial = category === "material";
  const hourly = category === "crew" || category === "plant";
  const c = columns(category, kinds, plantId);
  const n = item?.name ?? "new";
  const tiers = isMaterial || category === "plant" || category === "other";
  return (
    <form action={saveCostItem} style={{ borderTop: "1px solid var(--line-soft)", padding: "8px 0" }}>
      <fieldset disabled={!canEdit} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
        {item && <input type="hidden" name="id" value={item.id} />}
        <input type="hidden" name="category" value={category} />
        {plantId && <input type="hidden" name="supply_plant_id" value={plantId} />}
        {plantId && <input type="hidden" name="material_kind" value="asphalt" />}
        <div style={{ display: "grid", gridTemplateColumns: c.template, gap: 10, alignItems: "center" }}>
          <input type="text" name="name" aria-label="Name" defaultValue={item?.name ?? ""} required placeholder={item ? "" : plantId ? "Add a mix, e.g. AC10 C320" : "Add a new one"} />
          <input type="text" inputMode="decimal" name="rate" aria-label={`${n} rate (ex GST)`} defaultValue={item?.rate ?? ""} required placeholder="$" />
          <select name="unit" aria-label={`${n} per`} defaultValue={item?.unit ?? unitDefault ?? (isMaterial ? "t" : category === "float" ? "each" : "h")} style={sel}>
            {UNITS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          {hourly && (
            <>
              <input type="text" inputMode="decimal" name="ordinary_hours" aria-label={`${n} normal hours a day`} defaultValue={item?.ordinary_hours ?? (category === "crew" ? 8 : "")} placeholder={category === "crew" ? "8" : "–"} />
              <input type="text" inputMode="decimal" name="ot1_hours" aria-label={`${n} overtime hours`} defaultValue={item?.ot1_hours ?? 2} />
              <input type="text" inputMode="decimal" name="ot1_multiplier" aria-label={`${n} overtime rate (×)`} defaultValue={item?.ot1_multiplier ?? 1.5} />
              <input type="text" inputMode="decimal" name="ot2_multiplier" aria-label={`${n} after that (×)`} defaultValue={item?.ot2_multiplier ?? 2} />
            </>
          )}
          {isMaterial && kinds && !plantId && (
            <select name="material_kind" aria-label={`${n} type`} defaultValue={item?.material_kind ?? kinds[0][0]} style={sel}>
              {kinds.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          )}
          {isMaterial && (
            <input type="text" inputMode="decimal" name="density_t_per_m3" aria-label={`${n} density (t/m³)`} defaultValue={item?.density_t_per_m3 ?? (plantId && !item ? 2.4 : "")} placeholder={plantId ? "2.4" : "if by tonne"} />
          )}
          {category === "truck" && (
            <input type="text" inputMode="decimal" name="truck_capacity_t" aria-label={`${n} carries (t)`} defaultValue={item?.truck_capacity_t ?? 12} />
          )}
          {canEdit ? (
            <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
              {item && <button formAction={archiveCostItem} className="btn" style={{ padding: "9px 10px", color: "#9a3412", borderColor: "#f0b8a8", background: "#fdf1ed" }} aria-label={`Remove ${item.name}`}>Remove</button>}
              <button type="submit" className={`btn${item ? "" : " primary"}`} style={{ padding: "9px 14px", minWidth: 64 }}>{item ? "Save" : "Add"}</button>
            </div>
          ) : <span />}
        </div>
        {((isMaterial && !plantId) || tiers) && (
          <div className="row" style={{ gap: 16, marginTop: 6, fontSize: 13 }}>
            {isMaterial && !plantId && (
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 400 }}>
                <input type="checkbox" name="includes_delivery" defaultChecked={item?.includes_delivery ?? false} /> Price includes delivery
              </label>
            )}
            {tiers && (
              <details>
                <summary style={{ cursor: "pointer", color: "var(--ink-2)" }}>
                  Sliding scale{item?.rate_tiers?.length ? `: ${item.rate_tiers.length} price break${item.rate_tiers.length === 1 ? "" : "s"}` : " (optional)"}
                </summary>
                <p className="sub" style={{ fontSize: 12, margin: "6px 0" }}>The rate depends on job size. The whole job is priced at its band&apos;s rate; above your last break, the main rate applies.</p>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 150px))", gap: 6 }}>
                  {Array.from({ length: 5 }, (_, i) => {
                    const t = item?.rate_tiers?.[i];
                    return (
                      <div key={i} style={{ display: "contents" }}>
                        <input type="text" inputMode="decimal" name={`tier_up_to_${i}`} defaultValue={t?.up_to ?? ""} placeholder="Up to (e.g. 500)" aria-label={`Price break ${i + 1}: up to`} />
                        <input type="text" inputMode="decimal" name={`tier_rate_${i}`} defaultValue={t?.rate ?? ""} placeholder="Rate (e.g. 9.50)" aria-label={`Price break ${i + 1}: rate`} />
                      </div>
                    );
                  })}
                </div>
              </details>
            )}
          </div>
        )}
      </fieldset>
    </form>
  );
}

function CostSection({ s, items, canEdit }: { s: Section; items: Item[]; canEdit: boolean }) {
  const rows = items.filter(s.match);
  return (
    <section className="card">
      <h2 style={{ margin: 0 }}>{s.title}</h2>
      <p className="sub" style={{ marginTop: 2, marginBottom: 4, fontSize: 13 }}>{s.hint}</p>
      <div style={{ overflowX: "auto" }}>
        <div style={{ minWidth: 700 }}>
          <HeadRow category={s.category} kinds={s.kinds} />
          {rows.map((i) => <ItemForm key={i.id} item={i} category={s.category} canEdit={canEdit} kinds={s.kinds} />)}
          {canEdit && <ItemForm category={s.category} canEdit={canEdit} kinds={s.kinds} unitDefault={s.key === "seal" ? "m2" : undefined} />}
        </div>
      </div>
      {rows.length === 0 && !canEdit && <p className="sub">None yet.</p>}
    </section>
  );
}

export default async function CostsPage({ searchParams }: { searchParams: Promise<{ saved?: string; error?: string }> }) {
  const { saved, error } = await searchParams;
  const ctx = await requireTenant();
  const canEdit = ctx.role === "admin";
  const supabase = await createClient();
  const [{ data: items }, { data: plants }, { data: s }] = await Promise.all([
    supabase.from("cost_items").select("id, category, material_kind, name, unit, rate, density_t_per_m3, includes_delivery, truck_capacity_t, supply_plant_id, ordinary_hours, ot1_hours, ot1_multiplier, ot2_multiplier, rate_tiers")
      .eq("tenant_id", ctx.tenant.id).eq("active", true).order("name"),
    supabase.from("supply_plants").select("id, name, address, lat, lng, prices_valid_until, prices_note").eq("tenant_id", ctx.tenant.id).eq("active", true).order("name"),
    supabase.from("tenant_settings").select("margin_percent, truck_load_minutes, truck_unload_minutes, shift_minutes, road_factor, average_speed_kmh, gst_percent, quote_terms")
      .eq("tenant_id", ctx.tenant.id).maybeSingle(),
  ]);

  const hasAi = Boolean(keyFor(await liveModel()));
  const hasMaps = Boolean(process.env.GOOGLE_MAPS_API_KEY);
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Australia/Brisbane" });

  return (
    <div className="page" style={{ maxWidth: 1100 }}>
      <div>
        <Link href="/setup" className="sub" style={{ fontSize: 13 }}>← Setup</Link>
        <h1>Your costs</h1>
        <p className="sub">Set these once. Talk-to-quote prices every job from them, so quotes come out your way. All rates ex GST.</p>
      </div>
      {saved && <p style={{ color: "var(--good)", fontWeight: 600 }} role="status">{saved}</p>}
      {error && <p className="error" role="alert">{error}</p>}
      {!canEdit && <p className="sub">Only a client admin can change costs.</p>}

      {SECTIONS.map((sec) => <CostSection key={sec.key} s={sec} items={(items ?? []) as Item[]} canEdit={canEdit} />)}

      <section className="card" style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <h2 style={{ margin: 0 }}>Asphalt</h2>
        <p className="sub" style={{ marginTop: 2, marginBottom: 4, fontSize: 13 }}>
          Your asphalt comes from supply plants, and each plant has its own mix prices. Add each plant you buy from, then its mixes (or upload its price list). quoteout uses the nearest plant that has the mix, and the road distance sets the trucks.
          {!hasMaps && " Searching by business name works best once the Google maps key is added; street addresses work now."}
        </p>
      </section>
      {((items ?? []) as Item[]).some((i) => i.category === "material" && i.material_kind === "asphalt" && !i.supply_plant_id) && (
        <section className="card">
          <h3 style={{ margin: 0, fontSize: 15 }}>Asphalt not tied to a plant</h3>
          {((items ?? []) as Item[]).filter((i) => i.category === "material" && i.material_kind === "asphalt" && !i.supply_plant_id)
            .map((i) => <ItemForm key={i.id} item={i} category="material" canEdit={canEdit} kinds={[["asphalt", "Asphalt"], ["base", "Base"], ["other", "Other"]]} />)}
        </section>
      )}
      {((plants ?? []) as Plant[]).map((p) => {
        const mixes = ((items ?? []) as Item[]).filter((i) => i.supply_plant_id === p.id);
        const expired = p.prices_valid_until && p.prices_valid_until < today;
        return (
          <section key={p.id} className="card" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <div className="row" style={{ justifyContent: "space-between", alignItems: "baseline" }}>
              <h2 style={{ margin: 0 }}>{p.name}</h2>
              <span className="sub" style={{ marginTop: 0, fontSize: 13, color: expired ? "var(--bad, #b42318)" : undefined }}>
                {p.lat == null ? "Not on the map yet" : p.address ?? ""}
                {p.prices_valid_until ? ` · prices ${expired ? "expired" : "valid to"} ${p.prices_valid_until}` : ""}
              </span>
            </div>
            <PlantForm plant={p} canEdit={canEdit} />
            <h3 style={{ margin: "10px 0 0", fontSize: 15 }}>Mix prices at {p.name}</h3>
            {p.prices_note && <p className="sub" style={{ marginTop: 0, fontSize: 12 }}>{p.prices_note}</p>}
            {mixes.length === 0 && <p className="sub" style={{ marginTop: 0, fontSize: 13 }}>No prices for this plant yet. Upload their price list or type them in.</p>}
            {canEdit && <PriceListUpload tenantId={ctx.tenant.id} plantId={p.id} plantName={p.name} hasAi={hasAi} />}
            <div style={{ overflowX: "auto" }}>
              <div style={{ minWidth: 560 }}>
                <HeadRow category="material" plantId={p.id} />
                {mixes.map((i) => <ItemForm key={i.id} item={i} category="material" canEdit={canEdit} plantId={p.id} />)}
                {canEdit && <ItemForm category="material" canEdit={canEdit} plantId={p.id} />}
              </div>
            </div>
          </section>
        );
      })}
      {canEdit && (
        <section className="card" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <h2 style={{ margin: 0 }}>Add a supply plant</h2>
          <PlantForm canEdit={canEdit} />
        </section>
      )}

      {AFTER_ASPHALT.map((sec) => <CostSection key={sec.key} s={sec} items={(items ?? []) as Item[]} canEdit={canEdit} />)}

      <form action={savePricingSettings} className="card" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <h2 style={{ margin: 0 }}>Pricing settings</h2>
        <fieldset disabled={!canEdit} style={{ border: 0, padding: 0, margin: 0, ...grid }}>
          <label style={field}>Default margin (%)<input type="text" inputMode="decimal" name="margin_percent" defaultValue={s?.margin_percent ?? 15} /></label>
          <label style={field}>Truck loading (min)<input type="text" inputMode="decimal" name="truck_load_minutes" defaultValue={s?.truck_load_minutes ?? 15} /></label>
          <label style={field}>Truck tipping (min)<input type="text" inputMode="decimal" name="truck_unload_minutes" defaultValue={s?.truck_unload_minutes ?? 10} /></label>
          <label style={field}>Shift length (min)<input type="text" inputMode="decimal" name="shift_minutes" defaultValue={s?.shift_minutes ?? 480} /></label>
          <label style={field}>GST (%)<input type="text" inputMode="decimal" name="gst_percent" defaultValue={s?.gst_percent ?? 10} /></label>
        </fieldset>
        <label style={field}>Terms printed on quotes
          <textarea name="quote_terms" rows={4} defaultValue={s?.quote_terms ?? DEFAULT_TERMS} disabled={!canEdit} />
          <span className="sub" style={{ marginTop: 0, fontSize: 12, fontWeight: 400 }}>{"{bitumen_month}"} is filled in with the month the quote was done.</span>
        </label>
        {canEdit && <div><button type="submit" className="btn primary">Save pricing settings</button></div>}
        <p className="sub" style={{ marginTop: 0, fontSize: 13 }}>Margin is on the selling price: at 15%, a $85 cost sells for $100.</p>
      </form>
    </div>
  );
}
