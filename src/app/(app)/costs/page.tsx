import { requireTenant } from "@/lib/tenant";
import { createClient } from "@/lib/supabase/server";
import { archiveCostItem, saveCostItem, savePricingSettings } from "./actions";
import { PlantForm } from "./plant-form";
import { PriceListUpload } from "./price-list";

type Item = {
  id: string; category: string; material_kind: string | null; name: string; unit: string; rate: number;
  density_t_per_m3: number | null; includes_delivery: boolean; truck_capacity_t: number | null; supply_plant_id: string | null;
};
type Plant = { id: string; name: string; address: string | null; lat: number | null; lng: number | null; prices_valid_until: string | null; prices_note: string | null };

const GROUPS = [
  { key: "crew", title: "Crew", hint: "Per shift, day or hour" },
  { key: "material", title: "Materials (any plant)", hint: "Per tonne, m² or m³. Asphalt and base sold by the tonne need a density. Mixes priced at one plant go under that plant below." },
  { key: "plant", title: "Plant and hire", hint: "Bobcat, profiler, roller and so on" },
  { key: "truck", title: "Trucks", hint: "Used for cartage from the supply plant" },
  { key: "other", title: "Other", hint: "Anything else you charge" },
] as const;
const UNITS = [["shift", "shift"], ["day", "day"], ["h", "hour"], ["t", "tonne"], ["m2", "m²"], ["m3", "m³"], ["each", "each"], ["km", "km"]];

const grid: React.CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 10, alignItems: "end" };
const field: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 4, fontSize: 13 };

function ItemForm({ item, category, canEdit, plantId }: { item?: Item; category: string; canEdit: boolean; plantId?: string }) {
  return (
    <form action={saveCostItem} style={{ borderTop: "1px solid var(--line-soft)", padding: "12px 0" }}>
      <fieldset disabled={!canEdit} style={{ border: 0, padding: 0, margin: 0, ...grid }}>
        {item && <input type="hidden" name="id" value={item.id} />}
        <input type="hidden" name="category" value={category} />
        {plantId && <input type="hidden" name="supply_plant_id" value={plantId} />}
        <label style={{ ...field, gridColumn: "span 2" }}>Name<input type="text" name="name" defaultValue={item?.name ?? ""} required placeholder={item ? "" : plantId ? "Add a mix, e.g. AC10 C320" : "Add a new one"} /></label>
        <label style={field}>Rate (AUD ex GST)<input type="text" inputMode="decimal" name="rate" defaultValue={item?.rate ?? ""} required /></label>
        <label style={field}>Per
          <select name="unit" defaultValue={item?.unit ?? (category === "crew" ? "shift" : category === "material" ? "t" : "h")} style={{ font: "inherit", padding: 11, borderRadius: 8, border: "1px solid #b5b2ab" }}>
            {UNITS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
        {category === "material" && (
          <>
            <label style={field}>Kind
              <select name="material_kind" defaultValue={item?.material_kind ?? "asphalt"} style={{ font: "inherit", padding: 11, borderRadius: 8, border: "1px solid #b5b2ab" }}>
                <option value="asphalt">Asphalt</option><option value="base">Base</option><option value="prime">Prime</option><option value="seal">Seal</option><option value="other">Other</option>
              </select>
            </label>
            <label style={field}>Density (t/m³)<input type="text" inputMode="decimal" name="density_t_per_m3" defaultValue={item?.density_t_per_m3 ?? ""} placeholder="e.g. 2.4" /></label>
            <label style={{ ...field, flexDirection: "row", alignItems: "center", gap: 8, fontWeight: 400 }}>
              <input type="checkbox" name="includes_delivery" defaultChecked={item?.includes_delivery ?? false} /> Supplier delivers
            </label>
          </>
        )}
        {category === "truck" && (
          <label style={field}>Capacity (t)<input type="text" inputMode="decimal" name="truck_capacity_t" defaultValue={item?.truck_capacity_t ?? 12} /></label>
        )}
        {canEdit && (
          <div className="row" style={{ gap: 8 }}>
            <button type="submit" className={`btn${item ? "" : " primary"}`} style={{ padding: "9px 14px" }}>{item ? "Save" : "Add"}</button>
            {item && <button formAction={archiveCostItem} className="btn" style={{ padding: "9px 14px" }} aria-label={`Remove ${item.name}`}>Remove</button>}
          </div>
        )}
      </fieldset>
    </form>
  );
}

export default async function CostsPage({ searchParams }: { searchParams: Promise<{ saved?: string; error?: string }> }) {
  const { saved, error } = await searchParams;
  const ctx = await requireTenant();
  const canEdit = ctx.role === "admin";
  const supabase = await createClient();
  const [{ data: items }, { data: plants }, { data: s }] = await Promise.all([
    supabase.from("cost_items").select("id, category, material_kind, name, unit, rate, density_t_per_m3, includes_delivery, truck_capacity_t, supply_plant_id")
      .eq("tenant_id", ctx.tenant.id).eq("active", true).order("name"),
    supabase.from("supply_plants").select("id, name, address, lat, lng, prices_valid_until, prices_note").eq("tenant_id", ctx.tenant.id).eq("active", true).order("name"),
    supabase.from("tenant_settings").select("margin_percent, truck_load_minutes, truck_unload_minutes, shift_minutes, road_factor, average_speed_kmh, gst_percent, quote_terms")
      .eq("tenant_id", ctx.tenant.id).maybeSingle(),
  ]);

  const hasAi = Boolean(process.env.XAI_API_KEY);
  const hasMaps = Boolean(process.env.GOOGLE_MAPS_API_KEY);
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Australia/Brisbane" });

  return (
    <div className="page" style={{ maxWidth: 920 }}>
      <div>
        <h1>Your costs</h1>
        <p className="sub">Set these once. Talk-to-quote prices every job from them, so quotes come out your way. All rates ex GST.</p>
      </div>
      {saved && <p style={{ color: "var(--good)", fontWeight: 600 }} role="status">{saved}</p>}
      {error && <p className="error" role="alert">{error}</p>}
      {!canEdit && <p className="sub">Only a client admin can change costs.</p>}

      {GROUPS.map((g) => {
        const rows = ((items ?? []) as Item[]).filter((i) => i.category === g.key && !i.supply_plant_id);
        return (
          <section key={g.key} className="card">
            <h2 style={{ margin: 0 }}>{g.title}</h2>
            <p className="sub" style={{ marginTop: 2, marginBottom: 4, fontSize: 13 }}>{g.hint}</p>
            {rows.map((i) => <ItemForm key={i.id} item={i} category={g.key} canEdit={canEdit} />)}
            {canEdit && <ItemForm category={g.key} canEdit={canEdit} />}
          </section>
        );
      })}

      <section className="card" style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <h2 style={{ margin: 0 }}>Supply plants and their prices</h2>
        <p className="sub" style={{ marginTop: 2, marginBottom: 4, fontSize: 13 }}>
          Where your mix comes from, and what each plant charges. The road distance from the plant to the site sets the trucks.
          {!hasMaps && " Searching by business name works best once the Google maps key is added; street addresses work now."}
        </p>
      </section>
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

      <form action={savePricingSettings} className="card" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <h2 style={{ margin: 0 }}>Pricing settings</h2>
        <fieldset disabled={!canEdit} style={{ border: 0, padding: 0, margin: 0, ...grid }}>
          <label style={field}>Default margin (%)<input type="text" inputMode="decimal" name="margin_percent" defaultValue={s?.margin_percent ?? 15} /></label>
          <label style={field}>Truck loading (min)<input type="text" inputMode="decimal" name="truck_load_minutes" defaultValue={s?.truck_load_minutes ?? 15} /></label>
          <label style={field}>Truck tipping (min)<input type="text" inputMode="decimal" name="truck_unload_minutes" defaultValue={s?.truck_unload_minutes ?? 10} /></label>
          <label style={field}>Shift length (min)<input type="text" inputMode="decimal" name="shift_minutes" defaultValue={s?.shift_minutes ?? 480} /></label>
          <label style={field}>Average truck speed (km/h)<input type="text" inputMode="decimal" name="average_speed_kmh" defaultValue={s?.average_speed_kmh ?? 60} /></label>
          <label style={field}>Road factor<input type="text" inputMode="decimal" name="road_factor" defaultValue={s?.road_factor ?? 1.3} /></label>
          <label style={field}>GST (%)<input type="text" inputMode="decimal" name="gst_percent" defaultValue={s?.gst_percent ?? 10} /></label>
        </fieldset>
        <label style={field}>Terms printed on quotes
          <textarea name="quote_terms" rows={3} defaultValue={s?.quote_terms ?? ""} disabled={!canEdit} />
        </label>
        {canEdit && <div><button type="submit" className="btn primary">Save pricing settings</button></div>}
        <p className="sub" style={{ marginTop: 0, fontSize: 13 }}>Margin is on the selling price: at 15%, a $85 cost sells for $100. Road factor turns straight-line distance into road distance.</p>
      </form>
    </div>
  );
}
