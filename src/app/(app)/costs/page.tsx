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
  { key: "crew", category: "crew", title: "Crew", hint: "Per hour, with overtime: e.g. $1,200 an hour for 8 ordinary hours, then 2 hours at 1.5×, then 2×. Per shift or day also works.", match: (i) => i.category === "crew" },
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
const sel: React.CSSProperties = { font: "inherit", padding: 11, borderRadius: 8, border: "1px solid #b5b2ab", background: "#fff" };
/** Every cost row: fields on the left, Save/Remove always in the same column on the right. */
const row: React.CSSProperties = { display: "grid", gridTemplateColumns: "minmax(0, 1fr) 176px", gap: 12, alignItems: "end", borderTop: "1px solid var(--line-soft)", padding: "12px 0" };
const actions: React.CSSProperties = { display: "flex", gap: 8, justifyContent: "flex-end", alignSelf: "end" };

function ItemForm({ item, category, canEdit, plantId, kinds, unitDefault }: {
  item?: Item; category: string; canEdit: boolean; plantId?: string; kinds?: [string, string][]; unitDefault?: string;
}) {
  const isMaterial = category === "material";
  const hourly = category === "crew" || category === "plant";
  return (
    <form action={saveCostItem} style={row}>
      <fieldset disabled={!canEdit} style={{ border: 0, padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 10, minWidth: 0 }}>
        {item && <input type="hidden" name="id" value={item.id} />}
        <input type="hidden" name="category" value={category} />
        {plantId && <input type="hidden" name="supply_plant_id" value={plantId} />}
        {plantId && <input type="hidden" name="material_kind" value="asphalt" />}
        <div style={grid}>
          <label style={{ ...field, gridColumn: "span 2" }}>Name<input type="text" name="name" defaultValue={item?.name ?? ""} required placeholder={item ? "" : plantId ? "Add a mix, e.g. AC10 C320" : "Add a new one"} /></label>
          <label style={field}>Rate (ex GST)<input type="text" inputMode="decimal" name="rate" defaultValue={item?.rate ?? ""} required /></label>
          <label style={field}>Per
            <select name="unit" defaultValue={item?.unit ?? unitDefault ?? (isMaterial ? "t" : category === "float" ? "each" : "h")} style={sel}>
              {UNITS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
          {isMaterial && !plantId && kinds && (
            <label style={field}>Type
              <select name="material_kind" defaultValue={item?.material_kind ?? kinds[0][0]} style={sel}>
                {kinds.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </label>
          )}
          {isMaterial && (
            <label style={field}>Density (t/m³)<input type="text" inputMode="decimal" name="density_t_per_m3" defaultValue={item?.density_t_per_m3 ?? (plantId && !item ? 2.4 : "")} placeholder={plantId ? "2.4" : "if sold by tonne"} /></label>
          )}
          {hourly && (
            <>
              <label style={field}>Ordinary hours<input type="text" inputMode="decimal" name="ordinary_hours" defaultValue={item?.ordinary_hours ?? (category === "crew" ? 8 : "")} placeholder={category === "crew" ? "8" : "no overtime"} /></label>
              <label style={field}>Then hours at ×
                <span style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4 }}>
                  <input type="text" inputMode="decimal" name="ot1_hours" defaultValue={item?.ot1_hours ?? 2} aria-label="Time and a half hours" />
                  <input type="text" inputMode="decimal" name="ot1_multiplier" defaultValue={item?.ot1_multiplier ?? 1.5} aria-label="Time and a half rate (×)" />
                </span>
              </label>
              <label style={field}>After that ×<input type="text" inputMode="decimal" name="ot2_multiplier" defaultValue={item?.ot2_multiplier ?? 2} /></label>
            </>
          )}
          {category === "truck" && (
            <label style={field}>Capacity (t)<input type="text" inputMode="decimal" name="truck_capacity_t" defaultValue={item?.truck_capacity_t ?? 12} /></label>
          )}
        </div>
        {isMaterial && !plantId && (
          <label style={{ ...field, flexDirection: "row", alignItems: "center", gap: 8, fontWeight: 400 }}>
            <input type="checkbox" name="includes_delivery" defaultChecked={item?.includes_delivery ?? false} /> Price includes delivery to site
          </label>
        )}
        {(isMaterial || category === "plant" || category === "other") && (
          <details>
            <summary style={{ cursor: "pointer", fontSize: 13, color: "var(--ink-2)" }}>
              Sliding scale{item?.rate_tiers?.length ? `: ${item.rate_tiers.length} price break${item.rate_tiers.length === 1 ? "" : "s"}` : " (optional)"}
            </summary>
            <p className="sub" style={{ fontSize: 12, margin: "6px 0" }}>The rate depends on job size. The whole job is priced at its band&apos;s rate; above your last break, the rate above applies.</p>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 160px))", gap: 6 }}>
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
      </fieldset>
      {canEdit && (
        <div style={actions}>
          {item && <button formAction={archiveCostItem} className="btn" style={{ padding: "9px 12px", color: "#9a3412", borderColor: "#f0b8a8", background: "#fdf1ed" }} aria-label={`Remove ${item.name}`}>Remove</button>}
          <button type="submit" className={`btn${item ? "" : " primary"}`} style={{ padding: "9px 14px", minWidth: 72 }}>{item ? "Save" : "Add"}</button>
        </div>
      )}
    </form>
  );
}

function CostSection({ s, items, canEdit }: { s: Section; items: Item[]; canEdit: boolean }) {
  const rows = items.filter(s.match);
  return (
    <section className="card">
      <h2 style={{ margin: 0 }}>{s.title}</h2>
      <p className="sub" style={{ marginTop: 2, marginBottom: 4, fontSize: 13 }}>{s.hint}</p>
      {rows.map((i) => <ItemForm key={i.id} item={i} category={s.category} canEdit={canEdit} kinds={s.kinds} />)}
      {canEdit && <ItemForm category={s.category} canEdit={canEdit} kinds={s.kinds} unitDefault={s.key === "seal" ? "m2" : undefined} />}
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

  const hasAi = Boolean(process.env.XAI_API_KEY);
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
            {mixes.map((i) => <ItemForm key={i.id} item={i} category="material" canEdit={canEdit} plantId={p.id} />)}
            {canEdit && <ItemForm category="material" canEdit={canEdit} plantId={p.id} />}
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
        <details>
          <summary style={{ cursor: "pointer", fontSize: 13, color: "var(--ink-2)" }}>Backup for when a road route can&apos;t be found</summary>
          <p className="sub" style={{ fontSize: 12, margin: "6px 0" }}>Distances and drive times come from the actual road route (Google Maps once it&apos;s switched on). These two are only used if no route comes back.</p>
          <fieldset disabled={!canEdit} style={{ border: 0, padding: 0, margin: 0, ...grid }}>
            <label style={field}>Average truck speed (km/h)<input type="text" inputMode="decimal" name="average_speed_kmh" defaultValue={s?.average_speed_kmh ?? 60} /></label>
            <label style={field}>Road factor<input type="text" inputMode="decimal" name="road_factor" defaultValue={s?.road_factor ?? 1.3} /></label>
          </fieldset>
        </details>
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
