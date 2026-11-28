"use client";

import { useActionState, useState } from "react";
import { saveSettings, type SaveState } from "./actions";
import { AutoSave } from "../auto-save";

export type Settings = {
  margin_mode: "none" | "per_shift" | "percent";
  margin_per_shift: number | null;
  margin_percent: number | null;
  whole_dollar_rates: boolean;
  default_binder: string | null;
  default_prime: string | null;
  spray_markup_percent: number | null;
  extra_establishment_rate: number | null;
  change_tolerance_percent: number;
  reuse_quote_numbers: boolean;
  pass_on_rules: string | null;
  info_request_signature: string | null;
};

const initialState: SaveState = { ok: true, message: "" };

const field: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 6 };
const hint: React.CSSProperties = { color: "var(--muted)", fontSize: 13, fontWeight: 400 };
const grid: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
  gap: 16,
};

export function SettingsForm({ initial, canEdit }: { initial: Settings; canEdit: boolean }) {
  const [state, formAction, pending] = useActionState(saveSettings, initialState);
  const [mode, setMode] = useState(initial.margin_mode);

  return (
    <form id="pricing" action={formAction} style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <fieldset disabled={!canEdit} style={{ border: 0, padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 20 }}>
        <section className="card" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <h2 style={{ margin: 0 }}>Pricing target</h2>
          <p className="sub" style={{ marginTop: 0 }}>
            What the draft price aims for. Your estimator always reviews and sets the final price.
          </p>
          <div role="radiogroup" aria-label="Margin target" className="row" style={{ gap: 10 }}>
            {[
              { v: "none", label: "No target" },
              { v: "per_shift", label: "$ per asphalt shift" },
              { v: "percent", label: "% of the total" },
            ].map((o) => (
              <label
                key={o.v}
                style={{
                  display: "flex", alignItems: "center", gap: 8, padding: "10px 14px", borderRadius: 20, cursor: "pointer",
                  border: mode === o.v ? "2px solid var(--ink)" : "1px solid #b6bcc4",
                  fontWeight: mode === o.v ? 600 : 400,
                }}
              >
                <input
                  type="radio"
                  name="margin_mode"
                  value={o.v}
                  checked={mode === o.v}
                  onChange={() => setMode(o.v as Settings["margin_mode"])}
                />
                {o.label}
              </label>
            ))}
          </div>
          {mode === "per_shift" && (
            <div style={{ ...field, maxWidth: 260 }}>
              <label htmlFor="margin_per_shift">Margin per asphalt shift (AUD)</label>
              <input id="margin_per_shift" name="margin_per_shift" type="text" inputMode="decimal"
                defaultValue={initial.margin_per_shift ?? ""} placeholder="e.g. 7000" />
            </div>
          )}
          {mode === "percent" && (
            <div style={{ ...field, maxWidth: 260 }}>
              <label htmlFor="margin_percent">Margin (% of total)</label>
              <input id="margin_percent" name="margin_percent" type="text" inputMode="decimal"
                defaultValue={initial.margin_percent ?? ""} placeholder="e.g. 12" />
            </div>
          )}
          <label style={{ display: "flex", gap: 10, alignItems: "center", fontWeight: 400 }}>
            <input type="checkbox" name="whole_dollar_rates" defaultChecked={initial.whole_dollar_rates} />
            Round supply-and-lay rates to whole dollars where possible
          </label>
        </section>

        <section className="card" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <h2 style={{ margin: 0 }}>Defaults the rules use</h2>
          <div style={grid}>
            <div style={field}>
              <label htmlFor="default_binder">Default binder <span style={hint}>used when none is stated</span></label>
              <input id="default_binder" name="default_binder" type="text" defaultValue={initial.default_binder ?? ""} placeholder="e.g. C320" />
            </div>
            <div style={field}>
              <label htmlFor="default_prime">Default prime <span style={hint}>for prime-only jobs</span></label>
              <input id="default_prime" name="default_prime" type="text" defaultValue={initial.default_prime ?? ""} placeholder="e.g. K2" />
            </div>
            <div style={field}>
              <label htmlFor="spray_markup_percent">Spray mark-up (%)</label>
              <input id="spray_markup_percent" name="spray_markup_percent" type="text" inputMode="decimal"
                defaultValue={initial.spray_markup_percent ?? ""} placeholder="e.g. 15" />
            </div>
            <div style={field}>
              <label htmlFor="extra_establishment_rate">Extra establishment rate (AUD each)</label>
              <input id="extra_establishment_rate" name="extra_establishment_rate" type="text" inputMode="decimal"
                defaultValue={initial.extra_establishment_rate ?? ""} placeholder="e.g. 4000" />
            </div>
            <div style={field}>
              <label htmlFor="change_tolerance_percent">Flag drawing vs RFQ differences over (%)</label>
              <input id="change_tolerance_percent" name="change_tolerance_percent" type="text" inputMode="decimal"
                defaultValue={initial.change_tolerance_percent ?? 5} />
            </div>
          </div>
        </section>

      </fieldset>

      {canEdit ? (
        <div className="row" style={{ gap: 12 }}>
          <AutoSave />
          <span className="sub" style={{ marginTop: 0 }}>{pending ? "Saving..." : "Changes save on their own."}</span>
          <span aria-live="polite" className={state.ok ? "" : "error"} style={{ color: state.ok ? "var(--good)" : undefined, fontWeight: 600 }}>
            {state.message}
          </span>
        </div>
      ) : (
        <p className="sub">Only a client admin can change these settings.</p>
      )}
    </form>
  );
}
