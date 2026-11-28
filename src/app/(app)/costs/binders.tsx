import { BINDERS, binderLabel } from "@/lib/binder";
import { saveBinders } from "./actions";

/**
 * At one plant: which binder its mix prices include, and the extra $/t for the others.
 * A job asking for AC14 in C600 is priced as the plant's AC14 + the C600 extra.
 */
export function BinderExtras({ plantId, plantName, base, extras, canEdit }: {
  plantId: string; plantName: string; base: string; extras: { binder: string; extra_per_t: number }[]; canEdit: boolean;
}) {
  const rows = [...extras, { binder: "", extra_per_t: NaN }];
  const listId = `binders-${plantId}`;
  return (
    <form action={saveBinders} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <input type="hidden" name="plant_id" value={plantId} />
      <datalist id={listId}>{BINDERS.map((b) => <option key={b.code} value={b.label} />)}</datalist>
      <fieldset disabled={!canEdit} style={{ border: 0, padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
        <label style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, fontSize: 14 }}>
          Mix prices at {plantName} include
          <input name="base_binder" list={listId} defaultValue={binderLabel(base)} style={{ width: 160 }} aria-label="Base binder" />
        </label>
        <div style={{ display: "grid", gridTemplateColumns: "minmax(150px, 220px) minmax(110px, 150px)", gap: 8, alignItems: "center" }}>
          <span className="sub" style={{ marginTop: 0, fontSize: 12, fontWeight: 600 }}>Other binder</span>
          <span className="sub" style={{ marginTop: 0, fontSize: 12, fontWeight: 600 }}>Extra $ per tonne</span>
          {rows.map((r, n) => (
            <BinderRow key={`${r.binder}-${n}`} n={n} binder={r.binder} extra={r.extra_per_t} listId={listId} />
          ))}
        </div>
        <span className="sub" style={{ marginTop: 0, fontSize: 12 }}>
          Clear the extra to remove a binder. Price lists that show &ldquo;extra over&rdquo; for binders fill these in when you upload them.
        </span>
        {canEdit && <div><button type="submit" className="btn" style={{ padding: "9px 14px" }}>Save binders</button></div>}
      </fieldset>
    </form>
  );
}

function BinderRow({ n, binder, extra, listId }: { n: number; binder: string; extra: number; listId: string }) {
  return (
    <>
      <input name={`binder_${n}`} list={listId} defaultValue={binder ? binderLabel(binder) : ""} placeholder={binder ? "" : "Add a binder, e.g. C600"} aria-label="Binder" />
      <input name={`extra_${n}`} type="text" inputMode="decimal" defaultValue={Number.isFinite(extra) ? extra : ""} placeholder="$" aria-label="Extra per tonne" />
    </>
  );
}
