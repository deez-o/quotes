"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { money, priceSiteQuote, type CostItem, type LabourLine, type PricingSettings, type ScopeItem, type SiteScope, type SupplyPlant } from "@/lib/site/price";
import { haulFor } from "@/lib/site/load";
import { correctSiteScope, saveSiteQuote } from "../actions";
import { useDictation } from "../dictation";

export type QuoteView = {
  id: string; quote_no: string | null; status: "draft" | "sent" | "won" | "lost";
  customer_name: string | null; customer_email: string | null; site_address: string | null;
  site_lat: number | null; site_lng: number | null; transcript: string | null; photoUrls: string[];
  scope: SiteScope; margin_percent: number;
};

const UNIT: Record<string, string> = { shift: "shifts", day: "days", h: "hours", t: "t", m2: "m²", m3: "m³", each: "each", km: "km" };
const KIND_LABEL: Record<ScopeItem["kind"], string> = { asphalt: "Asphalt", base: "Base", prime: "Prime", seal: "Seal", excavation: "Excavation", other: "Other" };
const toNum = (s: string) => (s.trim() === "" ? null : Number(s.replace(/[,\s]/g, "")));
const small: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 4, fontSize: 12, fontWeight: 600 };
const sel: React.CSSProperties = { font: "inherit", padding: 10, borderRadius: 8, border: "1px solid #b5b2ab", background: "#fff", width: "100%" };
let keySeq = 0;
const newKey = (p: string) => `${p}${Date.now().toString(36)}${keySeq++}`;

export function SiteQuoteEditor({ quote, library, plants, settings, hasAi, canEdit }: {
  quote: QuoteView; library: CostItem[]; plants: SupplyPlant[]; settings: PricingSettings; hasAi: boolean; canEdit: boolean;
}) {
  const router = useRouter();
  const [scope, setScope] = useState<SiteScope>(quote.scope);
  const [margin, setMargin] = useState(quote.margin_percent);
  const [customer, setCustomer] = useState(quote.customer_name ?? "");
  const [email, setEmail] = useState(quote.customer_email ?? "");
  const [address, setAddress] = useState(quote.site_address ?? "");
  const [correction, setCorrection] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState<null | "save" | "fix" | "print">(null);
  const [dirty, setDirty] = useState(false);
  const dictation = useDictation((t) => setCorrection((c) => (c ? `${c} ${t}` : t)));

  const active = library.filter((c) => c.active);
  const haul = useMemo(() => haulFor(scope, { lat: quote.site_lat, lng: quote.site_lng }, plants, settings), [scope, quote.site_lat, quote.site_lng, plants, settings]);
  const priced = useMemo(() => priceSiteQuote({ scope, library, settings, haul, marginPercent: margin }), [scope, library, settings, haul, margin]);

  const update = (s: SiteScope) => { setScope(s); setDirty(true); };
  const setItem = (key: string, patch: Partial<ScopeItem>) => update({ ...scope, items: scope.items.map((i) => (i.key === key ? { ...i, ...patch } : i)) });
  const setLine = (group: "crew" | "plant", key: string, patch: Partial<LabourLine>) => update({ ...scope, [group]: scope[group].map((l) => (l.key === key ? { ...l, ...patch } : l)) });
  const optionsFor = (kind: ScopeItem["kind"]) =>
    active.filter((c) => (["asphalt", "base", "prime", "seal"].includes(kind) ? c.category === "material" && (c.material_kind === kind || c.material_kind === "other") : c.category !== "crew" && c.category !== "truck"));

  async function save(then?: "print") {
    setBusy(then ?? "save");
    setMsg(null);
    const r = await saveSiteQuote({ id: quote.id, scope, marginPercent: margin, customer, customerEmail: email, address });
    setBusy(null);
    if (!r.ok) return setMsg({ ok: false, text: r.message });
    setDirty(false);
    if (then === "print") window.open(`/print/site/${quote.id}`, "_blank");
    else setMsg({ ok: true, text: "Saved." });
    router.refresh();
  }

  async function applyCorrection() {
    dictation.stop();
    setBusy("fix");
    setMsg(null);
    const r = await correctSiteScope({ id: quote.id, scope, correction });
    setBusy(null);
    if (!r.ok) return setMsg({ ok: false, text: r.message });
    update(r.scope);
    setCorrection("");
    setMsg({ ok: true, text: "Updated. Check it, then save." });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <fieldset disabled={!canEdit} style={{ border: 0, padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 14 }}>
        <input type="text" aria-label="Quote title" value={scope.title} onChange={(e) => update({ ...scope, title: e.target.value })}
          style={{ fontFamily: "var(--font-head)", fontSize: 22, fontWeight: 600, border: "1px solid transparent", background: "transparent", padding: "4px 0" }} />

        {(scope.questions.length > 0 || scope.assumptions.length > 0) && (
          <section className="card" style={{ background: "var(--warn-bg)", borderColor: "#f0dba5", display: "flex", flexDirection: "column", gap: 6 }}>
            <strong>To confirm</strong>
            {scope.questions.map((q, i) => <div key={`q${i}`}>• {q}</div>)}
            {scope.assumptions.map((a, i) => <div key={`a${i}`} style={{ color: "var(--ink-2)" }}>• Assumed: {a}</div>)}
          </section>
        )}

        {hasAi && (
          <section className="card" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <label htmlFor="fix" style={{ fontWeight: 600 }}>{dictation.listening ? <span style={{ color: "var(--accent)" }}>● Listening...</span> : "Change something"}</label>
            <textarea id="fix" rows={2} value={dictation.interim ? `${correction} ${dictation.interim}`.trim() : correction}
              onChange={(e) => setCorrection(e.target.value)} placeholder="e.g. make it 50 mil, and it's two days not one" />
            <div className="row" style={{ gap: 8 }}>
              {dictation.supported && (
                <button type="button" className="btn" onClick={dictation.listening ? dictation.stop : dictation.start}>{dictation.listening ? "Stop" : "Talk"}</button>
              )}
              <button type="button" className="btn dark" disabled={busy !== null || correction.trim().length < 3} onClick={applyCorrection}>
                {busy === "fix" ? "Updating..." : "Apply"}
              </button>
            </div>
          </section>
        )}

        <section className="card">
          <h2>What&apos;s in the job</h2>
          {scope.items.map((i) => {
            const ci = active.find((c) => c.id === i.cost_item_id);
            const byArea = ["asphalt", "base", "prime", "seal"].includes(i.kind) || ci?.unit === "m2";
            const needsDepth = i.kind === "asphalt" || i.kind === "base" || ci?.unit === "m3";
            return (
              <div key={i.key} style={{ borderTop: "1px solid var(--line-soft)", padding: "12px 0", display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))", gap: 8, alignItems: "end" }}>
                <label style={{ ...small, gridColumn: "1 / -1" }}>Description
                  <input type="text" value={i.description} onChange={(e) => setItem(i.key, { description: e.target.value })} />
                </label>
                <label style={small}>Type
                  <select style={sel} value={i.kind} onChange={(e) => setItem(i.key, { kind: e.target.value as ScopeItem["kind"] })}>
                    {Object.entries(KIND_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </label>
                <label style={{ ...small, gridColumn: "span 2" }}>From your costs
                  <select style={sel} value={i.cost_item_id ?? ""} onChange={(e) => setItem(i.key, { cost_item_id: e.target.value || null })}>
                    <option value="">Choose...</option>
                    {optionsFor(i.kind).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </label>
                {byArea && (
                  <label style={small}>Area (m²)<input type="text" inputMode="decimal" value={i.area_m2 ?? ""} onChange={(e) => setItem(i.key, { area_m2: toNum(e.target.value) })} /></label>
                )}
                {needsDepth && (
                  <label style={small}>Depth (mm)<input type="text" inputMode="decimal" value={i.depth_mm ?? ""} onChange={(e) => setItem(i.key, { depth_mm: toNum(e.target.value) })} /></label>
                )}
                {!byArea && (
                  <label style={small}>Quantity ({ci ? UNIT[ci.unit] : "units"})<input type="text" inputMode="decimal" value={i.quantity ?? ""} onChange={(e) => setItem(i.key, { quantity: toNum(e.target.value) })} /></label>
                )}
                <button type="button" className="btn" style={{ padding: "9px 12px" }} onClick={() => update({ ...scope, items: scope.items.filter((x) => x.key !== i.key) })}>Remove</button>
              </div>
            );
          })}
          <button type="button" className="btn" style={{ marginTop: 8 }} onClick={() => update({ ...scope, items: [...scope.items, { key: newKey("i"), kind: "asphalt", description: "", area_m2: null, depth_mm: null, cost_item_id: null, quantity: null }] })}>
            + Add item
          </button>
        </section>

        {(["crew", "plant"] as const).map((group) => (
          <section key={group} className="card">
            <h2>{group === "crew" ? "Crew" : "Plant and hire"}</h2>
            {scope[group].map((l) => {
              const ci = active.find((c) => c.id === l.cost_item_id);
              return (
                <div key={l.key} className="row" style={{ borderTop: "1px solid var(--line-soft)", padding: "10px 0", gap: 8, alignItems: "end" }}>
                  <label style={{ ...small, flex: "2 1 160px" }}>Item
                    <select style={sel} value={l.cost_item_id} onChange={(e) => setLine(group, l.key, { cost_item_id: e.target.value })}>
                      {active.filter((c) => (group === "crew" ? c.category === "crew" : c.category === "plant" || c.category === "other")).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </label>
                  <label style={{ ...small, flex: "1 1 90px" }}>{ci ? UNIT[ci.unit] : "Amount"}
                    <input type="text" inputMode="decimal" value={l.amount} onChange={(e) => setLine(group, l.key, { amount: toNum(e.target.value) ?? 0 })} />
                  </label>
                  <button type="button" className="btn" style={{ padding: "9px 12px" }} onClick={() => update({ ...scope, [group]: scope[group].filter((x) => x.key !== l.key) })}>Remove</button>
                </div>
              );
            })}
            {(() => {
              const first = active.find((c) => (group === "crew" ? c.category === "crew" : c.category === "plant" || c.category === "other"));
              return first ? (
                <button type="button" className="btn" style={{ marginTop: 8 }} onClick={() => update({ ...scope, [group]: [...scope[group], { key: newKey(group[0]), cost_item_id: first.id, amount: 1, note: null }] })}>
                  + Add {group === "crew" ? "crew" : "plant or hire"}
                </button>
              ) : <p className="sub" style={{ fontSize: 13 }}>Add {group === "crew" ? "crew" : "plant"} rates on the Costs screen first.</p>;
            })()}
          </section>
        ))}

        <section className="card" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <h2 style={{ margin: 0 }}>Cartage</h2>
          <label style={small}>Mix comes from
            <select style={sel} value={scope.supply_plant_id ?? ""} onChange={(e) => update({ ...scope, supply_plant_id: e.target.value || null, haul_override: null })}>
              <option value="">Choose a plant...</option>
              {plants.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
          <div className="row" style={{ gap: 8, alignItems: "end" }}>
            <label style={{ ...small, flex: "1 1 100px" }}>One way (km)
              <input type="text" inputMode="decimal" value={haul?.km ?? ""} onChange={(e) => update({ ...scope, haul_override: { km: toNum(e.target.value) ?? 0, minutes: haul?.minutes ?? 0 } })} />
            </label>
            <label style={{ ...small, flex: "1 1 100px" }}>One way (min)
              <input type="text" inputMode="decimal" value={haul?.minutes ?? ""} onChange={(e) => update({ ...scope, haul_override: { km: haul?.km ?? 0, minutes: toNum(e.target.value) ?? 0 } })} />
            </label>
            <span className="sub" style={{ marginTop: 0, fontSize: 12, flex: "2 1 160px" }}>
              {haul ? (haul.source === "gps" ? "Estimated from your GPS location. Change it if you know better." : "Entered by you.") : "Pick a plant (and use GPS on site) or enter the distance."}
            </span>
          </div>
        </section>
      </fieldset>

      <section className="card" style={{ background: "var(--ink)", color: "#f6f5f2", borderColor: "var(--ink)" }}>
        <div style={{ fontSize: 13, color: "#b5b2ab" }}>Quote price, ex GST</div>
        <div style={{ fontFamily: "var(--font-head)", fontSize: 38, fontWeight: 600 }}>{money(priced.priceExGst)}</div>
        <div style={{ fontSize: 13, color: "#d9d7d2" }}>Cost {money(priced.cost)} · profit {money(priced.profit)} · inc GST {money(priced.priceIncGst)}</div>
        <label htmlFor="margin" style={{ display: "flex", justifyContent: "space-between", marginTop: 14, fontWeight: 600 }}><span>Margin</span><span>{margin}%</span></label>
        <input id="margin" type="range" min={0} max={50} step={0.5} value={margin} disabled={!canEdit}
          onChange={(e) => { setMargin(Number(e.target.value)); setDirty(true); }} style={{ width: "100%", accentColor: "#c2410c" }} />
      </section>

      {priced.warnings.length > 0 && (
        <section className="card" style={{ borderColor: "var(--accent)" }}>
          <strong>Not priced yet</strong>
          {priced.warnings.map((w, i) => <div key={i} style={{ marginTop: 4 }}>• {w}</div>)}
        </section>
      )}

      <section className="card">
        <h2>How it&apos;s worked out</h2>
        <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {priced.costLines.map((l) => (
            <li key={l.key} className="row" style={{ padding: "10px 0", borderTop: "1px solid var(--line-soft)", gap: 10, alignItems: "flex-start" }}>
              <div className="grow"><div style={{ fontWeight: 600 }}>{l.label}</div><div className="sub" style={{ marginTop: 0, fontSize: 13 }}>{l.working}</div></div>
              <strong>{money(l.cost)}</strong>
            </li>
          ))}
        </ul>
      </section>

      <section className="card">
        <h2>What your customer sees</h2>
        <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {priced.customerLines.map((l) => (
            <li key={l.key} className="row" style={{ padding: "8px 0", borderTop: "1px solid var(--line-soft)", gap: 10 }}>
              <span className="grow">{l.description}<span className="sub" style={{ display: "block", marginTop: 0, fontSize: 12 }}>{l.quantity.toLocaleString("en-AU")} {l.unit} @ {money(l.rate)}</span></span>
              <strong>{money(l.total)}</strong>
            </li>
          ))}
          <li className="row" style={{ padding: "8px 0", borderTop: "2px solid var(--ink)", fontWeight: 600 }}><span className="grow">Total ex GST</span><span>{money(priced.priceExGst)}</span></li>
          <li className="row" style={{ padding: "2px 0", color: "var(--muted)" }}><span className="grow">GST</span><span>{money(priced.gst)}</span></li>
          <li className="row" style={{ padding: "2px 0", fontWeight: 600 }}><span className="grow">Total inc GST</span><span>{money(priced.priceIncGst)}</span></li>
        </ul>
      </section>

      <section className="card" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 10 }}>
        <label style={small}>Customer<input type="text" value={customer} disabled={!canEdit} onChange={(e) => { setCustomer(e.target.value); setDirty(true); }} /></label>
        <label style={small}>Customer email<input type="email" value={email} disabled={!canEdit} onChange={(e) => { setEmail(e.target.value); setDirty(true); }} /></label>
        <label style={{ ...small, gridColumn: "1 / -1" }}>Site address<input type="text" value={address} disabled={!canEdit} onChange={(e) => { setAddress(e.target.value); setDirty(true); }} /></label>
      </section>

      {quote.transcript && (
        <details className="card">
          <summary style={{ fontWeight: 600, cursor: "pointer" }}>What you said on site</summary>
          <p style={{ marginTop: 8, whiteSpace: "pre-wrap" }}>{quote.transcript}</p>
          {quote.photoUrls.length > 0 && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 8, marginTop: 8 }}>
              {quote.photoUrls.map((u) => (
                // eslint-disable-next-line @next/next/no-img-element -- signed storage URL
                <a key={u} href={u} target="_blank" rel="noreferrer"><img src={u} alt="Site photo" style={{ width: "100%", aspectRatio: "1", objectFit: "cover", borderRadius: 8 }} /></a>
              ))}
            </div>
          )}
        </details>
      )}

      {msg && <p className={msg.ok ? "" : "error"} style={msg.ok ? { color: "var(--good)", fontWeight: 600 } : undefined} role="status">{msg.text}</p>}

      {canEdit && (
        <div style={{ position: "sticky", bottom: 0, background: "var(--ground)", padding: "10px 0 14px", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 8 }}>
          <button type="button" className="btn primary" disabled={busy !== null} onClick={() => save()}>{busy === "save" ? "Saving..." : dirty ? "Save changes" : "Saved"}</button>
          <button type="button" className="btn" disabled={busy !== null} onClick={() => save("print")}>{busy === "print" ? "Opening..." : "PDF / print"}</button>
          <button type="button" className="btn" disabled title="Xero connection comes next">Send to Xero (soon)</button>
        </div>
      )}
    </div>
  );
}
