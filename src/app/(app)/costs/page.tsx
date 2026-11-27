import { requireTenant } from "@/lib/tenant";
import { createClient } from "@/lib/supabase/server";
import { archiveCostItem, archivePlant, saveCostItem, savePlant, savePricingSettings } from "./actions";

type Item = {
  id: string; category: string; material_kind: string | null; name: string; unit: string; rate: number;
  density_t_per_m3: number | null; includes_delivery: boolean; truck_capacity_t: number | null;
};
type Plant = { id: string; name: string; address: string | null; lat: number | null; lng: number | null };

const GROUPS = [
  { key: "crew", title: "Crew", hint: "Per shift, day or hour" },
  { key: "material", title: "Materials", hint: "Per tonne, m² or m³. Asphalt and base sold by the tonne need a density." },
  { key: "plant", title: "Plant and hire", hint: "Bobcat, profiler, roller and so on" },
  { key: "truck", title: "Trucks", hint: "Used for cartage from the supply plant" },
  { key: "other", title: "Other", hint: "Anything else you charge" },
] as const;
const UNITS = [["shift", "shift"], ["day", "day"], ["h", "hour"], ["t", "tonne"], ["m2", "m²"], ["m3", "m³"], ["each", "each"], ["km", "km"]];

const grid: React.CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 10, alignItems: "end" };
const field: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 4, fontSize: 13 };

function ItemForm({ item, category, canEdit }: { item?: Item; category: string; canEdit: boolean }) {
  return (
    <form action={saveCostItem} style={{ borderTop: "1px solid var(--line-soft)", padding: "12px 0" }}>
      <fieldset disabled={!canEdit} style={{ border: 0, padding: 0, margin: 0, ...grid }}>
        {item && <input type="hidden" name="id" value={item.id} />}
        <input type="hidden" name="category" value={category} />
        <label style={{ ...field, gridColumn: "span 2" }}>Name<input type="text" name="name" defaultValue={item?.name ?? ""} required placeholder={item ? "" : "Add a new one"} /></label>
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
    supabase.from("cost_items").select("id, category, material_kind, name, unit, rate, density_t_per_m3, includes_delivery, truck_capacity_t")
      .eq("tenant_id", ctx.tenant.id).eq("active", true).order("name"),
    supabase.from("supply_plants").select("id, name, address, lat, lng").eq("tenant_id", ctx.tenant.id).eq("active", true).order("name"),
    supabase.from("tenant_settings").select("margin_percent, truck_load_minutes, truck_unload_minutes, shift_minutes, road_factor, average_speed_kmh, gst_percent, quote_terms")
      .eq("tenant_id", ctx.tenant.id).maybeSingle(),
  ]);

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
        const rows = ((items ?? []) as Item[]).filter((i) => i.category === g.key);
        return (
          <section key={g.key} className="card">
            <h2 style={{ margin: 0 }}>{g.title}</h2>
            <p className="sub" style={{ marginTop: 2, marginBottom: 4, fontSize: 13 }}>{g.hint}</p>
            {rows.map((i) => <ItemForm key={i.id} item={i} category={g.key} canEdit={canEdit} />)}
            {canEdit && <ItemForm category={g.key} canEdit={canEdit} />}
          </section>
        );
      })}

      <section className="card">
        <h2 style={{ margin: 0 }}>Supply plants</h2>
        <p className="sub" style={{ marginTop: 2, marginBottom: 4, fontSize: 13 }}>Where your mix comes from. The distance to the site sets the number of trucks.</p>
        {((plants ?? []) as Plant[]).concat(canEdit ? [{ id: "", name: "", address: null, lat: null, lng: null }] : []).map((p) => (
          <form key={p.id || "new"} action={savePlant} style={{ borderTop: "1px solid var(--line-soft)", padding: "12px 0" }}>
            <fieldset disabled={!canEdit} style={{ border: 0, padding: 0, margin: 0, ...grid }}>
              {p.id && <input type="hidden" name="id" value={p.id} />}
              <label style={field}>Name<input type="text" name="name" defaultValue={p.name} required placeholder={p.id ? "" : "Add a plant"} /></label>
              <label style={{ ...field, gridColumn: "span 2" }}>Address<input type="text" name="address" defaultValue={p.address ?? ""} placeholder="Street, suburb, state" /></label>
              <label style={field}>Latitude<input type="text" inputMode="decimal" name="lat" defaultValue={p.lat ?? ""} placeholder="found from address" /></label>
              <label style={field}>Longitude<input type="text" inputMode="decimal" name="lng" defaultValue={p.lng ?? ""} placeholder="found from address" /></label>
              {canEdit && (
                <div className="row" style={{ gap: 8 }}>
                  <button type="submit" className={`btn${p.id ? "" : " primary"}`} style={{ padding: "9px 14px" }}>{p.id ? "Save" : "Add"}</button>
                  {p.id && <button formAction={archivePlant} className="btn" style={{ padding: "9px 14px" }}>Remove</button>}
                </div>
              )}
            </fieldset>
          </form>
        ))}
      </section>

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
