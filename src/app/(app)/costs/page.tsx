import { Suspense } from "react";
import { KeepScroll, Toast } from "../keep-scroll";
import { keyFor, liveModel } from "@/lib/ai/call";
import Link from "next/link";
import { requireTenant } from "@/lib/tenant";
import { createClient } from "@/lib/supabase/server";
import { archiveCostItem, saveCostItem, savePricingSettings } from "./actions";
import { PlantForm } from "./plant-form";
import { BinderExtras } from "./binders";
import { AutoSave } from "../auto-save";
import { DEFAULT_TERMS } from "@/lib/site/terms";
import { DEFAULT_QUOTE_MESSAGE } from "@/lib/quote/email";
import { toShown } from "@/lib/quote/placeholders";
import { PriceListUpload } from "./price-list";

type Item = {
  id: string; category: string; material_kind: string | null; name: string; unit: string; rate: number;
  density_t_per_m3: number | null; includes_delivery: boolean; truck_capacity_t: number | null; supply_plant_id: string | null;
  ordinary_hours: number | null; ot1_hours: number | null; ot1_multiplier: number | null; ot2_multiplier: number | null;
  rate_tiers: { up_to: number; rate: number }[] | null;
  min_hours?: number | null;
  sell_rate?: number | null;
};
type Plant = { id: string; name: string; address: string | null; lat: number | null; lng: number | null; prices_valid_until: string | null; prices_note: string | null; base_binder: string | null };

type Section = { key: string; category: string; title: string; hint: string; kinds?: [string, string][]; match: (i: Item) => boolean };

const SECTIONS: Section[] = [
  { key: "crew", category: "crew", title: "Crew", hint: "Per hour, with overtime. Normal hrs at the rate, then OT hrs at OT × the rate, then the rest at Then ×. E.g. $1,200 an hour, 8 normal hours, 2 at 1.5×, then 2×.", match: (i) => i.category === "crew" },
  { key: "material", category: "material", title: "Materials", hint: "Base, crushed rock and other materials. Bought by the tonne? Put its weight per m³ (t/m³, e.g. 2.2 for crushed rock) so quoteout can work out tonnes from area and depth.", kinds: [["base", "Base"], ["other", "Other"]],
    match: (i) => i.category === "material" && !i.supply_plant_id && !["asphalt", "seal", "prime", "tack"].includes(i.material_kind ?? "") },
  { key: "seal", category: "material", title: "Prime, tack coat and seal", hint: "Per m². Use a sliding scale when the rate depends on job size. Sell at: a fixed price per m² for the quote (e.g. tack coat costs $2, always quoted at $3); leave it blank to put your margin on like everything else.", kinds: [["prime", "Prime"], ["tack", "Tack coat"], ["seal", "Seal"]],
    match: (i) => i.category === "material" && !i.supply_plant_id && ["seal", "prime", "tack"].includes(i.material_kind ?? "") },
];
const AFTER_ASPHALT: Section[] = [
  { key: "plant", category: "plant", title: "Plant and hire", hint: "Bobcat, profiler, MTV / shuttle buggy and so on. Profiling can have more than one: per hour, and per m² if builders ask for an m² rate. Min hrs: the least you pay for in a day (e.g. 6 for a bobcat with a 6-hour minimum). Leave it blank if there's no minimum. Call the MTV \"MTV\" or \"shuttle buggy\" so RFQs that ask for one pick it up.", match: (i) => i.category === "plant" },
  { key: "truck", category: "truck", title: "Trucks", hint: "Used for cartage from the supply plant. Min hrs: the least each truck is paid for in a day.", match: (i) => i.category === "truck" },
  { key: "float", category: "float", title: "Float", hint: "Moving the paver and roller to site, per move. Added to every asphalt job as a cost and built into the asphalt rate; it isn't its own line on the quote.", match: (i) => i.category === "float" },
  { key: "establishment", category: "establishment", title: "Establishment", hint: "What you charge each time you set up on site (per establishment). Shown as its own line on the quote, once per set-up the job needs: an RFQ asking for four establishments gets four. Also used for \"extra establishment\" rates when a builder asks.", match: (i) => i.category === "establishment" },
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
    base.push("Normal hrs", "OT hrs", "OT ×", "Then ×", "Min hrs");
    t.push("78px", "64px", "64px", "64px", "64px");
  } else if (category === "material") {
    if (kinds && !plantId) { base.push("Type"); t.push("110px"); }
    // Seal and prime are per m² or litre: no density.
    if (!kinds?.some(([v]) => v === "seal")) { base.push("t/m³"); t.push("72px"); }
    else { base.push("Sell at"); t.push("90px"); }
  } else if (category === "truck") {
    base.push("Carries (t)", "Min hrs"); t.push("84px", "64px");
  }
  return { heads: [...base, ""], template: [...t, ACTIONS_COL].join(" ") };
}

/** One field in a cost line; its label only shows on phones, where the lines stack. */
function Cell({ label, wide, children }: { label: string; wide?: boolean; children: React.ReactNode }) {
  return <div className={wide ? "cost-cell wide" : "cost-cell"}><span className="cost-label" aria-hidden="true">{label}</span>{children}</div>;
}

function HeadRow({ category, kinds, plantId }: { category: string; kinds?: [string, string][]; plantId?: string }) {
  const c = columns(category, kinds, plantId);
  return (
    <div aria-hidden="true" className="cost-head" style={{ display: "grid", gridTemplateColumns: c.template, gap: 10, padding: "10px 0 6px", fontSize: 12, fontWeight: 600, color: "var(--muted)" }}>
      {c.heads.map((h, i) => <span key={i}>{h}</span>)}
    </div>
  );
}

function ItemForm({ item, category, canEdit, plantId, kinds, unitDefault, sliding = false, defaultName }: {
  item?: Item; category: string; canEdit: boolean; plantId?: string; kinds?: [string, string][]; unitDefault?: string; sliding?: boolean; defaultName?: string;
}) {
  const isMaterial = category === "material";
  const hourly = category === "crew" || category === "plant";
  const c = columns(category, kinds, plantId);
  const n = item?.name ?? "new";
  // Job-size price breaks: spray seal only (and any item that already has some, so they can be cleared).
  const tiers = sliding || Boolean(item?.rate_tiers?.length);
  // Trucks, bobcats and crew hired by the hour often have a minimum (e.g. 6 hours).
  const hireMin = category === "crew" || category === "plant" || category === "truck";
  return (
    <form action={saveCostItem} style={{ borderTop: "1px solid var(--line-soft)", padding: "8px 0" }}>
      {canEdit && <AutoSave isNew={!item} />}
      <fieldset disabled={!canEdit} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
        {item && <input type="hidden" name="id" value={item.id} />}
        <input type="hidden" name="category" value={category} />
        {plantId && <input type="hidden" name="supply_plant_id" value={plantId} />}
        {plantId && <input type="hidden" name="material_kind" value="asphalt" />}
        <div className="cost-row" style={{ "--cols": c.template } as React.CSSProperties}>
          <Cell label="Name" wide><input type="text" name="name" aria-label="Name" defaultValue={item?.name ?? defaultName ?? ""} autoFocus={Boolean(defaultName)} required placeholder={item ? "" : plantId ? "Add a mix, e.g. AC10 C320" : "Add a new one"} /></Cell>
          <Cell label="Rate (ex GST)"><input type="text" inputMode="decimal" name="rate" aria-label={`${n} rate (ex GST)`} defaultValue={item && item.rate > 0 ? item.rate : ""} required placeholder={item ? "Add price" : "$"} className={item && !(item.rate > 0) ? "needs-price" : undefined} /></Cell>
          <Cell label="Per"><select name="unit" aria-label={`${n} per`} defaultValue={item?.unit ?? unitDefault ?? (isMaterial ? "t" : category === "float" || category === "establishment" ? "each" : "h")} style={sel}>
            {UNITS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select></Cell>
          {hourly && (
            <>
              <Cell label="Normal hrs"><input type="text" inputMode="decimal" name="ordinary_hours" aria-label={`${n} normal hours a day`} defaultValue={item?.ordinary_hours ?? (category === "crew" ? 8 : "")} placeholder={category === "crew" ? "8" : "–"} /></Cell>
              <Cell label="OT hrs"><input type="text" inputMode="decimal" name="ot1_hours" aria-label={`${n} overtime hours`} defaultValue={item?.ot1_hours ?? 2} /></Cell>
              <Cell label="OT ×"><input type="text" inputMode="decimal" name="ot1_multiplier" aria-label={`${n} overtime rate (×)`} defaultValue={item?.ot1_multiplier ?? 1.5} /></Cell>
              <Cell label="Then ×"><input type="text" inputMode="decimal" name="ot2_multiplier" aria-label={`${n} after that (×)`} defaultValue={item?.ot2_multiplier ?? 2} /></Cell>
            </>
          )}
          {isMaterial && kinds && !plantId && (
            <Cell label="Type"><select name="material_kind" aria-label={`${n} type`} defaultValue={item?.material_kind ?? kinds[0][0]} style={sel}>
              {kinds.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select></Cell>
          )}
          {isMaterial && !kinds?.some(([v]) => v === "seal") && (
            <Cell label="Weight (t/m³)"><input type="text" inputMode="decimal" name="density_t_per_m3" aria-label={`${n} density (t/m³)`} defaultValue={item?.density_t_per_m3 ?? (plantId && !item ? 2.4 : "")} placeholder={plantId ? "2.4" : "per tonne only"} /></Cell>
          )}
          {isMaterial && kinds?.some(([v]) => v === "seal") && (
            <Cell label="Sell at"><input type="text" inputMode="decimal" name="sell_rate" aria-label={`${n} sell at (fixed price on the quote)`} title="A fixed price on the quote, instead of your margin" defaultValue={item?.sell_rate ?? ""} placeholder="margin" /></Cell>
          )}
          {category === "truck" && (
            <Cell label="Carries (t)"><input type="text" inputMode="decimal" name="truck_capacity_t" aria-label={`${n} carries (t)`} defaultValue={item?.truck_capacity_t ?? 12} /></Cell>
          )}
          {hireMin && (
            <Cell label="Min hrs a day"><input type="text" inputMode="decimal" name="min_hours" aria-label={`${n} minimum hours a day`} title="Minimum hire: charged at least this many hours a day" defaultValue={item?.min_hours ?? ""} placeholder="–" /></Cell>
          )}
          {canEdit ? (
            <div className="cost-actions" style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
              {item && <button formAction={archiveCostItem} className="btn" style={{ padding: "9px 10px", color: "#9a3412", borderColor: "#f0b8a8", background: "#fdf1ed" }} aria-label={`Remove ${item.name}`}>Remove</button>}
              {!item && <button type="submit" className="btn primary" style={{ padding: "9px 14px", minWidth: 64 }}>Add</button>}
            </div>
          ) : <span />}
        </div>
        {((isMaterial && !plantId) || tiers) && (
          <div className="row" style={{ gap: 16, marginTop: 6, fontSize: 13, flexWrap: "wrap" }}>

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
      <div className="cost-scroll">
        <div className="cost-table">
          <HeadRow category={s.category} kinds={s.kinds} />
          {rows.map((i) => <ItemForm key={i.id} item={i} category={s.category} canEdit={canEdit} kinds={s.kinds} sliding={s.key === "seal"} />)}
          {canEdit && <ItemForm key={`new-${rows.map((r) => r.id).join()}`} category={s.category} canEdit={canEdit} kinds={s.kinds} unitDefault={s.key === "seal" ? "m2" : undefined} sliding={s.key === "seal"} />}
        </div>
      </div>
      {rows.length === 0 && !canEdit && <p className="sub">None yet.</p>}
    </section>
  );
}

export default async function CostsPage({ searchParams }: { searchParams: Promise<{ saved?: string; error?: string; mix?: string }> }) {
  const { saved, error, mix } = await searchParams;
  const addMix = mix && /^[\w .()-]{2,30}$/.test(mix) ? mix : null;
  const ctx = await requireTenant();
  const canEdit = ctx.role === "admin";
  const supabase = await createClient();
  const [{ data: items }, { data: plants }, { data: s }, { data: extras }] = await Promise.all([
    supabase.from("cost_items").select("id, category, material_kind, name, unit, rate, density_t_per_m3, includes_delivery, truck_capacity_t, supply_plant_id, ordinary_hours, ot1_hours, ot1_multiplier, ot2_multiplier, rate_tiers, min_hours, sell_rate")
      .eq("tenant_id", ctx.tenant.id).eq("active", true).order("name"),
    supabase.from("supply_plants").select("id, name, address, lat, lng, prices_valid_until, prices_note, base_binder").eq("tenant_id", ctx.tenant.id).eq("active", true).order("name"),
    supabase.from("tenant_settings").select("margin_percent, truck_load_minutes, truck_unload_minutes, shift_minutes, road_factor, average_speed_kmh, gst_percent, quote_terms, quote_email_message, binder_percent, notify_drafts")
      .eq("tenant_id", ctx.tenant.id).maybeSingle(),
    supabase.from("binder_extras").select("supply_plant_id, binder, extra_per_t").eq("tenant_id", ctx.tenant.id).order("binder"),
  ]);

  const hasAi = Boolean(keyFor(await liveModel()));
  const hasMaps = Boolean(process.env.GOOGLE_MAPS_API_KEY);
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Australia/Brisbane" });

  return (
    <div className="page" style={{ maxWidth: 1100 }}>
      <div>
        <Link href="/setup" className="btn back-btn">← Back to Setup</Link>
        <h1>Your costs</h1>
        <p className="sub">Set these once. Talk-to-quote prices every job from them, so quotes come out your way. All rates ex GST. Changes save as you go.</p>
      </div>
      <Suspense fallback={null}><KeepScroll /></Suspense>
      {saved && <Toast key={`s${saved}`} text={saved} ok />}
      {error && <Toast key={`e${error}`} text={error} ok={false} />}
      {!canEdit && <p className="sub">Only a client admin can change costs.</p>}

      {SECTIONS.map((sec) => <CostSection key={sec.key} s={sec} items={(items ?? []) as Item[]} canEdit={canEdit} />)}

      <section className="card" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div>
          <h2 style={{ margin: 0 }}>Asphalt</h2>
          <p className="sub" style={{ marginTop: 2, marginBottom: 0, fontSize: 13 }}>
            Your asphalt comes from supply plants, and each plant has its own mix prices. Add each plant you buy from, then its mixes (or upload its price list). quoteout uses the nearest plant that has the mix, and the road distance sets the trucks.
            {!hasMaps && " Searching by business name works best once the Google maps key is added; street addresses work now."}
          </p>
        </div>
        {((items ?? []) as Item[]).some((i) => i.category === "material" && i.material_kind === "asphalt" && !i.supply_plant_id) && (
          <div className="plant-panel">
            <h3 style={{ margin: 0, fontSize: 15 }}>Asphalt not tied to a plant</h3>
            {((items ?? []) as Item[]).filter((i) => i.category === "material" && i.material_kind === "asphalt" && !i.supply_plant_id)
              .map((i) => <ItemForm key={i.id} item={i} category="material" canEdit={canEdit} kinds={[["asphalt", "Asphalt"], ["base", "Base"], ["other", "Other"]]} />)}
          </div>
        )}
        {addMix && <p id="add-mix" className="sub" style={{ margin: 0, padding: "10px 12px", borderRadius: 8, background: "var(--warn-bg)", color: "var(--ink)" }}>Add <strong>{addMix}</strong> with its price per tonne at the plant you buy it from (it&apos;s filled in on the new row below), then go back to the quote: it picks the new price up by itself.</p>}
        {((plants ?? []) as Plant[]).map((p, pi) => {
          const mixes = ((items ?? []) as Item[]).filter((i) => i.supply_plant_id === p.id);
          const expired = p.prices_valid_until && p.prices_valid_until < today;
          const plantExtras = (extras ?? []).filter((e) => e.supply_plant_id === p.id).map((e) => ({ binder: e.binder as string, extra_per_t: Number(e.extra_per_t) }));
          return (
            <div key={p.id} id={`plant-${p.id}`} className="plant-panel">
              <div className="row" style={{ justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 6 }}>
                <h3 style={{ margin: 0, fontSize: 17 }}>{p.name}</h3>
                <span className="sub" style={{ marginTop: 0, fontSize: 13, color: expired ? "var(--bad, #b42318)" : undefined }}>
                  {p.lat == null ? "Not on the map yet" : p.address ?? ""}
                  {p.prices_valid_until ? ` · prices ${expired ? "expired" : "valid to"} ${p.prices_valid_until}` : ""}
                </span>
              </div>
              <PlantForm plant={p} canEdit={canEdit} />
              <h4 style={{ margin: "8px 0 0", fontSize: 15 }}>Mix prices</h4>
              {p.prices_note && <p className="sub" style={{ marginTop: 0, fontSize: 12 }}>{p.prices_note}</p>}
              {mixes.length === 0 && <p className="sub" style={{ marginTop: 0, fontSize: 13 }}>No prices for this plant yet. Upload their price list or type them in.</p>}
              {canEdit && <PriceListUpload tenantId={ctx.tenant.id} plantId={p.id} plantName={p.name} hasAi={hasAi} />}
              <div className="cost-scroll">
                <div className="cost-table">
                  <HeadRow category="material" plantId={p.id} />
                  {mixes.map((i) => <ItemForm key={i.id} item={i} category="material" canEdit={canEdit} plantId={p.id} />)}
                  {canEdit && <ItemForm key={`new-${mixes.map((m) => m.id).join()}-${pi === 0 ? addMix ?? "" : ""}`} category="material" canEdit={canEdit} plantId={p.id} defaultName={pi === 0 ? addMix ?? undefined : undefined} />}
                </div>
              </div>
              <h4 style={{ margin: "8px 0 0", fontSize: 15 }}>Binders</h4>
              <BinderExtras plantId={p.id} plantName={p.name} base={p.base_binder ?? "C320"} extras={plantExtras} canEdit={canEdit} />
            </div>
          );
        })}
        {canEdit && (
          <div className="plant-panel" style={{ borderStyle: "dashed" }}>
            <h3 style={{ margin: 0, fontSize: 15 }}>Add a supply plant</h3>
            <PlantForm canEdit={canEdit} />
          </div>
        )}
      </section>

      {AFTER_ASPHALT.map((sec) => <CostSection key={sec.key} s={sec} items={(items ?? []) as Item[]} canEdit={canEdit} />)}

      <form action={savePricingSettings} className="card" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <h2 style={{ margin: 0 }}>Pricing settings</h2>
        <fieldset disabled={!canEdit} style={{ border: 0, padding: 0, margin: 0, ...grid }}>
          <label style={field}>Loading a truck (minutes)<input type="text" inputMode="decimal" name="truck_load_minutes" defaultValue={s?.truck_load_minutes ?? 15} /></label>
          <label style={field}>Tipping a truck (minutes)<input type="text" inputMode="decimal" name="truck_unload_minutes" defaultValue={s?.truck_unload_minutes ?? 10} /></label>
          <label style={field}>Truck working day (hours)<input type="text" inputMode="decimal" name="shift_hours" defaultValue={Number(s?.shift_minutes ?? 480) / 60} /></label>
          <label style={field}>GST (%)<input type="text" inputMode="decimal" name="gst_percent" defaultValue={s?.gst_percent ?? 10} /></label>
          <label style={field}>Binder in asphalt (%)<input type="text" inputMode="decimal" name="binder_percent" defaultValue={s?.binder_percent ?? 5.5} /></label>
        </fieldset>
        <p className="sub" style={{ marginTop: 0, fontSize: 13 }}>
          Cartage is worked out from these: each load takes loading + the drive there and back + tipping. A truck does as many loads as fit in its working day; more loads than that means another truck. Binder in asphalt is how much of each tonne is bitumen, for rise and fall.
        </p>
        <label style={field}>Terms printed on quotes
          <textarea name="quote_terms" rows={5} defaultValue={toShown(s?.quote_terms ?? DEFAULT_TERMS)} disabled={!canEdit} />
          <span className="sub" style={{ marginTop: 0, fontSize: 12, fontWeight: 400 }}>[Bitumen month] becomes the month the quote was priced, e.g. November 2026.</span>
        </label>
        <label style={field}>Email that goes with a quote
          <textarea name="quote_email_message" rows={11} defaultValue={toShown(s?.quote_email_message ?? DEFAULT_QUOTE_MESSAGE)} disabled={!canEdit} />
          <span className="sub" style={{ marginTop: 0, fontSize: 12, fontWeight: 400 }}>Words in [square brackets] are filled in for each quote: [Customer] becomes the customer&apos;s first name, [Price] the total, [Your name] whoever sends it. You can still change the email before each send.</span>
        </label>
        <label style={{ display: "flex", gap: 8, alignItems: "center", fontWeight: 600 }}>
          <input type="checkbox" name="notify_drafts" defaultChecked={s?.notify_drafts !== false} disabled={!canEdit} /> Email us when an RFQ has been drafted and is ready to check
        </label>
        {canEdit && <AutoSave />}
        {canEdit && <span className="sub" style={{ marginTop: 0, fontSize: 12 }}>Changes save on their own.</span>}
        <p className="sub" style={{ marginTop: 0, fontSize: 13 }}>Your margin is set once in <Link href="/setup#pricing" style={{ textDecoration: "underline" }}>Setup → Pricing target</Link>{s?.margin_percent != null ? ` (now ${s.margin_percent}%)` : ""}, and you can change it on each quote.</p>
      </form>
    </div>
  );
}
