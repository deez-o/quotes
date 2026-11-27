"use client";
import Link from "next/link";
import { AreaMap } from "./overview/area-map";
import { SendQuoteDialog } from "./send";
import type { DrawnArea } from "@/lib/rfq/overview";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { alignToPlant, choosePlant, money, priceSiteQuote, type CostItem, type HaulRoutes, type LabourLine, type PricingSettings, type ScopeItem, type SiteScope, type SupplyPlant } from "@/lib/site/price";
import { haulFor } from "@/lib/site/load";
import { correctSiteScope, locateSite, saveSiteQuote, sendToXero } from "../actions";
import { PlaceSearch } from "../../place-search";
import { useDictation } from "../dictation";

import { ComparePanel, type CompareView } from "./compare";

export type RfqView = {
  from: string | null; subject: string | null; received: string | null;
  emails: { name: string; from: string | null; date: string | null; subject: string | null; body: string }[];
  files: { name: string; url: string | null; read: "text" | "image" | "no"; note: string | null }[];
};

export type QuoteView = {
  id: string; quote_no: string | null; status: "draft" | "sent" | "won" | "lost";
  customer_name: string | null; customer_email: string | null; site_address: string | null;
  site_lat: number | null; site_lng: number | null; haul_routes: HaulRoutes | null; xero_quote_number: string | null; transcript: string | null; photoUrls: string[];
  scope: SiteScope; margin_percent: number; areas: DrawnArea[];
};

const UNIT: Record<string, string> = { shift: "shifts", day: "days", h: "hours", t: "t", m2: "m²", m3: "m³", each: "each", km: "km" };
const KIND_LABEL: Record<ScopeItem["kind"], string> = { asphalt: "Asphalt", base: "Base", prime: "Prime", seal: "Seal", excavation: "Excavation", other: "Other" };
const toNum = (s: string) => (s.trim() === "" ? null : Number(s.replace(/[,\s]/g, "")));
const small: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 4, fontSize: 12, fontWeight: 600 };
const sel: React.CSSProperties = { font: "inherit", padding: 10, borderRadius: 8, border: "1px solid #b6bcc4", background: "#fff", width: "100%" };
let keySeq = 0;
const newKey = (p: string) => `${p}${Date.now().toString(36)}${keySeq++}`;

export function SiteQuoteEditor({ quote, library, plants, settings, hasAi, canEdit, hasXero, rfq = null, compare = null, hasSheet = false }: {
  quote: QuoteView; library: CostItem[]; plants: SupplyPlant[]; settings: PricingSettings; hasAi: boolean; canEdit: boolean; hasXero: boolean; rfq?: RfqView | null; compare?: CompareView | null; hasSheet?: boolean;
}) {
  const router = useRouter();
  const [scope, setScope] = useState<SiteScope>(quote.scope);
  const [margin, setMargin] = useState(quote.margin_percent);
  const [customer, setCustomer] = useState(quote.customer_name ?? "");
  const [email, setEmail] = useState(quote.customer_email ?? "");
  const [address, setAddress] = useState(quote.site_address ?? "");
  const [correction, setCorrection] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState<null | "save" | "fix" | "print" | "xero" | "excel">(null);
  const [dirty, setDirty] = useState(false);
  const [site, setSite] = useState({ lat: quote.site_lat, lng: quote.site_lng });
  const [routes, setRoutes] = useState<HaulRoutes | null>(quote.haul_routes);
  const [locating, setLocating] = useState(false);
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const activeQ = useRef<number | null>(null);
  const talkingTo = useRef<string>("fix");
  const [talkTarget, setTalkTarget] = useState("fix");
  const [mapOpen, setMapOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const talkTo = (t: string) => { talkingTo.current = t; setTalkTarget(t); };
  const dictation = useDictation((t) => {
    if (talkingTo.current.startsWith("q") && activeQ.current != null) {
      const i = activeQ.current;
      setAnswers((a) => ({ ...a, [i]: a[i] ? `${a[i]} ${t}` : t }));
    } else setCorrection((c) => (c ? `${c} ${t}` : t));
  });
  const answerFor = (i: number) => {
    const live = dictation.listening && talkTarget === `q${i}` && dictation.interim ? ` ${dictation.interim}` : "";
    return `${answers[i] ?? ""}${live}`;
  };

  const active = library.filter((c) => c.active);
  const haul = useMemo(() => haulFor(scope, site, plants, settings, routes), [scope, site, plants, settings, routes]);
  const plantName = (id: string | null | undefined) => plants.find((p) => p.id === id)?.name;

  async function placeSite(lat: number, lng: number, addr: string | null) {
    setLocating(true);
    setMsg(null);
    const r = await locateSite({ id: quote.id, lat, lng, address: addr });
    setLocating(false);
    if (!r.ok) return setMsg({ ok: false, text: r.message });
    setSite({ lat, lng });
    setRoutes(r.routes);
    if (addr) setAddress(addr);
    // Plant not picked by the user: re-pick the nearest for the new location.
    const next = scope.supply_plant_auto || !scope.supply_plant_id
      ? choosePlant({ scope, library, plants, settings, site: { lat, lng }, routes: r.routes })
      : scope;
    update({ ...next, haul_override: null });
    setMsg({ ok: true, text: r.routes ? "Site located. Road distances worked out." : "Site located. Couldn't get road distances, so they're estimated." });
  }
  const priced = useMemo(() => priceSiteQuote({ scope, library, settings, haul, marginPercent: margin }), [scope, library, settings, haul, margin]);

  const update = (s: SiteScope) => { setScope(s); setDirty(true); };
  const setItem = (key: string, patch: Partial<ScopeItem>) => update({ ...scope, items: scope.items.map((i) => (i.key === key ? { ...i, ...patch } : i)) });
  const setLine = (group: "crew" | "plant", key: string, patch: Partial<LabourLine>) => update({ ...scope, [group]: scope[group].map((l) => (l.key === key ? { ...l, ...patch } : l)) });
  // Mixes from the chosen plant (and general costs) first, then other plants' mixes.
  const plantOrder = (c: CostItem) => (!c.supply_plant_id || c.supply_plant_id === scope.supply_plant_id ? 0 : 1);
  const optionsFor = (kind: ScopeItem["kind"]) =>
    active.toSorted((a, b) => plantOrder(a) - plantOrder(b)).filter((c) => (["asphalt", "base", "prime", "seal"].includes(kind) ? c.category === "material" && (c.material_kind === kind || c.material_kind === "other") : c.category !== "crew" && c.category !== "truck" && c.category !== "float"));

  const [xeroNo, setXeroNo] = useState<string | null>(quote.xero_quote_number);
  async function toXero() {
    setBusy("xero");
    setMsg(null);
    if (dirty) {
      const s = await saveSiteQuote({ id: quote.id, scope, marginPercent: margin, customer, customerEmail: email, address });
      if (!s.ok) { setBusy(null); return setMsg({ ok: false, text: s.message }); }
      setDirty(false);
    }
    const r = await sendToXero({ id: quote.id, origin: window.location.origin });
    setBusy(null);
    if (!r.ok) return setMsg({ ok: false, text: r.message });
    setXeroNo(r.number);
    setMsg({ ok: true, text: `In Xero as draft quote ${r.number}. Open it in Xero to check and send.` });
    router.refresh();
  }

  async function openSend() {
    setMsg(null);
    if (dirty) {
      setBusy("save");
      const s = await saveSiteQuote({ id: quote.id, scope, marginPercent: margin, customer, customerEmail: email, address });
      setBusy(null);
      if (!s.ok) return setMsg({ ok: false, text: s.message });
      setDirty(false);
    }
    setSending(true);
  }

  async function save(then?: "print" | "excel") {
    setBusy(then ?? "save");
    setMsg(null);
    const r = await saveSiteQuote({ id: quote.id, scope, marginPercent: margin, customer, customerEmail: email, address });
    setBusy(null);
    if (!r.ok) return setMsg({ ok: false, text: r.message });
    setDirty(false);
    if (then === "print") window.open(`/print/site/${quote.id}`, "_blank");
    else if (then === "excel") {
      // A file download, not a page: a plain link click.
      const a = document.createElement("a");
      a.href = `/api/quotes/${quote.id}/xlsx`;
      a.download = "";
      a.click();
    }
    else setMsg({ ok: true, text: "Saved." });
    router.refresh();
  }

  /** Send the answers to the questions as a correction; answered questions drop off. */
  async function applyAnswers() {
    dictation.stop();
    const text = scope.questions.map((q, i) => (answers[i]?.trim() ? `Q: ${q}\nA: ${answers[i].trim()}` : null)).filter(Boolean).join("\n\n");
    if (!text) return;
    setBusy("fix");
    setMsg(null);
    const r = await correctSiteScope({ id: quote.id, scope, correction: `Answers to your questions:\n\n${text}` });
    setBusy(null);
    if (!r.ok) return setMsg({ ok: false, text: r.message });
    update(r.scope);
    setAnswers({});
    setMsg({ ok: true, text: "Updated with your answers. Check it, then save." });
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
    <div className="editor-grid">
      <div className="editor-main">
      <fieldset disabled={!canEdit} style={{ border: 0, padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
        <input type="text" aria-label="Quote title" value={scope.title} onChange={(e) => update({ ...scope, title: e.target.value })}
          style={{ fontFamily: "var(--font-head)", fontSize: 22, fontWeight: 600, border: "1px solid transparent", background: "transparent", padding: "4px 0" }} />

        {(scope.questions.length > 0 || scope.assumptions.length > 0) && (
          <section className="card" style={{ background: "var(--warn-bg)", borderColor: "#f0dba5", display: "flex", flexDirection: "column", gap: 6 }}>
            <strong>To confirm</strong>
            {scope.questions.map((q, i) => (
              <div key={`q${i}`} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <span style={{ fontWeight: 600 }}>{q}</span>
                {hasAi && (
                  <div className="row" style={{ gap: 6, flexWrap: "nowrap" }}>
                    <input type="text" aria-label={q} value={answerFor(i)} placeholder="Your answer"
                      onFocus={() => (activeQ.current = i)} onChange={(e) => setAnswers((a) => ({ ...a, [i]: e.target.value }))} style={{ flex: 1, minWidth: 0 }} />
                    {dictation.supported && (
                      <button type="button" className="btn" style={{ padding: "9px 12px" }} aria-label={`Answer by voice: ${q}`}
                        onClick={() => { if (dictation.listening && talkTarget === `q${i}`) { dictation.stop(); return; } talkTo(`q${i}`); activeQ.current = i; dictation.start(); }}>
                        {dictation.listening && talkTarget === `q${i}` ? "Stop" : "Talk"}
                      </button>
                    )}
                  </div>
                )}
              </div>
            ))}
            {hasAi && scope.questions.length > 0 && (
              <div>
                <button type="button" className="btn dark" disabled={busy !== null || !Object.values(answers).some((a) => a.trim())} onClick={applyAnswers}>
                  {busy === "fix" ? "Updating..." : "Update the quote"}
                </button>
              </div>
            )}
            {scope.assumptions.map((a, i) => <div key={`a${i}`} style={{ color: "var(--ink-2)" }}>• Assumed: {a}</div>)}
          </section>
        )}

        {hasAi && (
          <section className="card" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <label htmlFor="fix" style={{ fontWeight: 600 }}>{dictation.listening && talkTarget === "fix" ? <span style={{ color: "var(--accent)" }}>● Listening...</span> : "Change something"}</label>
            <textarea id="fix" rows={2} value={dictation.interim && talkTarget === "fix" ? `${correction} ${dictation.interim}`.trim() : correction}
              onChange={(e) => setCorrection(e.target.value)} placeholder="e.g. make it 50 mil, and it's two days not one" />
            <div className="row" style={{ gap: 8 }}>
              {dictation.supported && (
                <button type="button" className="btn" onClick={() => { if (dictation.listening) { dictation.stop(); return; } talkTo("fix"); dictation.start(); }}>{dictation.listening && talkTarget === "fix" ? "Stop" : "Talk"}</button>
              )}
              <button type="button" className="btn dark" disabled={busy !== null || correction.trim().length < 3} onClick={applyCorrection}>
                {busy === "fix" ? "Updating..." : "Apply"}
              </button>
            </div>
          </section>
        )}

        {compare && <ComparePanel quoteId={quote.id} view={compare} />}

        {rfq && (
          <details className="card" open>
            <summary style={{ fontWeight: 600, cursor: "pointer", fontSize: 18 }}>From the RFQ</summary>
            <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 10 }}>
              <div className="sub" style={{ marginTop: 0, fontSize: 13 }}>
                {rfq.from ?? "Unknown sender"}{rfq.received ? ` · ${new Date(rfq.received).toLocaleString("en-AU", { dateStyle: "medium", timeStyle: "short" })}` : ""}
                {rfq.subject ? <><br /><strong style={{ color: "var(--ink)" }}>{rfq.subject}</strong></> : null}
              </div>
              {rfq.files.length > 0 && (
                <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {rfq.files.map((f) => (
                    <li key={f.name}>
                      <a href={f.url ?? undefined} target="_blank" rel="noreferrer" title={f.read === "no" ? f.note ?? "Not read" : f.read === "image" ? "Looked at as a picture" : "Read"}
                        style={{ display: "inline-flex", gap: 6, alignItems: "center", border: "1px solid var(--line)", borderRadius: 8, padding: "6px 10px", fontSize: 13, background: f.read === "no" ? "var(--warn-bg)" : "#fff" }}>
                        <span aria-hidden="true">{f.read === "no" ? "⚠" : "📎"}</span>{f.name}
                      </a>
                    </li>
                  ))}
                </ul>
              )}
              {rfq.emails.map((e, i) => (
                <div key={e.name} style={{ borderTop: i ? "1px solid var(--line-soft)" : undefined, paddingTop: i ? 10 : 0 }}>
                  {i > 0 && <div className="sub" style={{ marginTop: 0, fontSize: 12, fontWeight: 600 }}>Later email · {e.from ?? ""}{e.date ? ` · ${e.date}` : ""}</div>}
                  <div style={{ whiteSpace: "pre-wrap", fontSize: 14, maxHeight: 320, overflowY: "auto", background: "var(--ground)", borderRadius: 8, padding: 12 }}>{e.body.trim() || "(no message text)"}</div>
                </div>
              ))}
            </div>
          </details>
        )}

        <section className="card">
          <h2>What&apos;s in the job</h2>
          {scope.items.map((i) => {
            const ci = active.find((c) => c.id === i.cost_item_id);
            const byArea = ["asphalt", "base", "prime", "seal"].includes(i.kind) || ci?.unit === "m2";
            const needsDepth = i.kind === "asphalt" || i.kind === "base" || ci?.unit === "m3";
            return (
              <div key={i.key} style={{ borderTop: "1px solid var(--line-soft)", padding: "12px 0", display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))", gap: 8, alignItems: "end" }}>
                <div style={{ gridColumn: "1 / -1", display: "flex", gap: 8, alignItems: "end" }}>
                  <label style={{ ...small, flex: 1, minWidth: 0 }}>{KIND_LABEL[i.kind]}
                    <input type="text" value={i.description} onChange={(e) => setItem(i.key, { description: e.target.value })} />
                  </label>
                  <button type="button" aria-label={`Remove ${i.description || KIND_LABEL[i.kind]}`} title="Remove this item"
                    onClick={() => update({ ...scope, items: scope.items.filter((x) => x.key !== i.key) })}
                    style={{ flex: "none", height: 44, padding: "0 14px", borderRadius: 8, border: "1px solid #f0b8a8", background: "#fdf1ed", color: "#9a3412", font: "inherit", fontWeight: 600, cursor: "pointer" }}>
                    ✕ Remove
                  </button>
                </div>
                <label style={small}>Type
                  <select style={sel} value={i.kind} onChange={(e) => setItem(i.key, { kind: e.target.value as ScopeItem["kind"] })}>
                    {Object.entries(KIND_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </label>
                <label style={{ ...small, gridColumn: "span 2" }}>From your costs
                  <select style={sel} value={i.cost_item_id ?? ""} onChange={(e) => setItem(i.key, { cost_item_id: e.target.value || null })}>
                    <option value="">Choose...</option>
                    {optionsFor(i.kind).map((c) => <option key={c.id} value={c.id}>{c.name}{c.supply_plant_id ? ` · ${plantName(c.supply_plant_id) ?? "other plant"}` : ""}</option>)}
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
              </div>
            );
          })}
          <button type="button" className="btn" style={{ marginTop: 8 }} onClick={() => update({ ...scope, items: [...scope.items, { key: newKey("i"), kind: "asphalt", description: "", area_m2: null, depth_mm: null, cost_item_id: null, quantity: null }] })}>
            + Add item
          </button>
        </section>

        <details className="card" onToggle={(e) => setMapOpen((e.currentTarget as HTMLDetailsElement).open)}>
          <summary style={{ cursor: "pointer", fontWeight: 700, fontSize: 17 }}>
            Measure on the map{quote.areas.length ? <span className="sub" style={{ fontWeight: 400, marginLeft: 8 }}>{quote.areas.length} area{quote.areas.length === 1 ? "" : "s"} traced</span> : null}
          </summary>
          <div style={{ marginTop: 10 }}>
            {site.lat == null || site.lng == null ? (
              <p className="sub">Add the site address first, so the map knows where to look.</p>
            ) : mapOpen ? (
              <AreaMap key={`${site.lat},${site.lng}`} bare quoteId={quote.id} center={{ lat: site.lat, lng: site.lng }} initial={quote.areas} canEdit={canEdit}
                browserKey={process.env.NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY ?? null}
                items={scope.items.map((i) => ({ key: i.key, label: i.description || KIND_LABEL[i.kind], area: i.area_m2 }))}
                onUse={(key, m2) => setItem(key, { area_m2: m2 })} />
            ) : null}
          </div>
        </details>

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
                  <label style={{ ...small, flex: "1 1 90px" }}>{ci?.unit === "h" ? "Hours a day" : ci ? `${UNIT[ci.unit]} a day` : "Amount"}
                    <input type="text" inputMode="decimal" value={l.amount || ""} placeholder="?" onChange={(e) => setLine(group, l.key, { amount: toNum(e.target.value) ?? 0 })}
                      style={!l.amount ? { borderColor: "var(--accent)" } : undefined} />
                  </label>
                  <label style={{ ...small, flex: "1 1 70px" }}>Days
                    <input type="text" inputMode="decimal" value={l.days ?? 1} onChange={(e) => setLine(group, l.key, { days: toNum(e.target.value) })} />
                  </label>
                  <button type="button" aria-label={`Remove ${ci?.name ?? "line"}`} onClick={() => update({ ...scope, [group]: scope[group].filter((x) => x.key !== l.key) })}
                    style={{ flex: "none", height: 44, padding: "0 14px", borderRadius: 8, border: "1px solid #f0b8a8", background: "#fdf1ed", color: "#9a3412", font: "inherit", fontWeight: 600, cursor: "pointer" }}>
                    ✕ Remove
                  </button>
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
          <label style={small}>Mix comes from{scope.supply_plant_auto ? " (nearest plant)" : ""}
            <select style={sel} value={scope.supply_plant_id ?? ""} onChange={(e) => update({ ...alignToPlant(scope, library, e.target.value || null), haul_override: null, supply_plant_auto: false })}>
              <option value="">Choose a plant...</option>
              {plants.map((p) => <option key={p.id} value={p.id}>{p.name}{routes?.[p.id] ? ` (${routes[p.id].km} km)` : ""}</option>)}
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
              {haul
                ? haul.source === "road" ? `Road distance from the site to ${plantName(scope.supply_plant_id) ?? "the plant"}; time allows for a loaded truck.`
                : haul.source === "gps" ? "Straight-line estimate. Find the site below for the real road distance, or type your own."
                : "Entered by you."
                : "Pick a plant and find the site, or enter the distance."}
            </span>
          </div>
          {active.some((c) => c.category === "float") && (
            <label style={{ ...small, maxWidth: 220 }}>Float moves (cost only, not on the quote)
              <input type="text" inputMode="decimal" value={scope.float_moves ?? (scope.items.some((i) => i.kind === "asphalt") ? 1 : 0)}
                onChange={(e) => update({ ...scope, float_moves: toNum(e.target.value) })} />
            </label>
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={small}>{site.lat == null ? "Where is the job? (no GPS was taken)" : "Job location"}</span>
            {site.lat != null && <span className="sub" style={{ marginTop: 0, fontSize: 13 }}>{address || `${site.lat.toFixed(4)}, ${site.lng?.toFixed(4)}`}{locating ? " · working out distances..." : ""}</span>}
            <PlaceSearch label="Find the job site" placeholder="Street and suburb, or a business name" near={site.lat != null && site.lng != null ? { lat: site.lat, lng: site.lng } : null}
              onPick={(p) => void placeSite(p.lat, p.lng, p.address || p.name)} />
          </div>
        </section>
      </fieldset>

      <section className="card" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 10 }}>
        <label style={small}>Customer<input type="text" value={customer} disabled={!canEdit} onChange={(e) => { setCustomer(e.target.value); setDirty(true); }} /></label>
        <label style={small}>Customer email<input type="email" value={email} disabled={!canEdit} onChange={(e) => { setEmail(e.target.value); setDirty(true); }} /></label>
        <label style={{ ...small, gridColumn: "1 / -1" }}>Site address<input type="text" value={address} disabled={!canEdit} onChange={(e) => { setAddress(e.target.value); setDirty(true); }} /></label>
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

      <details className="card" open>
        <summary style={{ fontWeight: 600, cursor: "pointer", fontSize: 18 }}>How it&apos;s worked out</summary>
        <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {priced.costLines.map((l) => (
            <li key={l.key} className="row" style={{ padding: "10px 0", borderTop: "1px solid var(--line-soft)", gap: 10, alignItems: "flex-start" }}>
              <div className="grow"><div style={{ fontWeight: 600 }}>{l.label}</div><div className="sub" style={{ marginTop: 0, fontSize: 13 }}>{l.working}</div></div>
              <strong>{money(l.cost)}</strong>
            </li>
          ))}
        </ul>
      </details>

      {quote.transcript && (
        <details className="card">
          <summary style={{ fontWeight: 600, cursor: "pointer" }}>What you said</summary>
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

      </div>

      <div className="editor-side">
      <section className="card" style={{ background: "var(--ink)", color: "#f3f4f6", borderColor: "var(--ink)" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div>
            <div style={{ fontSize: 13, color: "#b6bcc4" }}>Quote price, ex GST</div>
            <div style={{ fontFamily: "var(--font-head)", fontSize: 34, fontWeight: 600, lineHeight: 1.1 }}>{money(priced.priceExGst)}</div>
            <div style={{ fontSize: 13, color: "#d6d9de" }}>inc GST {money(priced.priceIncGst)}</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 13, color: "#b6bcc4" }}>Profit</div>
            <div style={{ fontFamily: "var(--font-head)", fontSize: 34, fontWeight: 600, lineHeight: 1.1, color: priced.profit > 0 ? "#86efac" : "#fca5a5" }}>{money(priced.profit)}</div>
            <div style={{ fontSize: 13, color: "#d6d9de" }}>
              {priced.profitPerShift != null ? `${money(Math.round(priced.profitPerShift))} a shift` : `cost ${money(priced.cost)}`}
            </div>
          </div>
        </div>
        {priced.perTonne && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, marginTop: 14, paddingTop: 12, borderTop: "1px solid #3a3936" }}>
            {[
              ["Asphalt price", `${money(Math.round(priced.perTonne.price))}/t`],
              ["Cost", `${money(Math.round(priced.perTonne.cost))}/t`],
              ["Profit", `${money(Math.round(priced.perTonne.profit))}/t`],
            ].map(([l, v]) => (
              <div key={l}>
                <div style={{ fontSize: 12, color: "#b6bcc4" }}>{l}</div>
                <div style={{ fontSize: 20, fontWeight: 600 }}>{v}</div>
              </div>
            ))}
            <div style={{ gridColumn: "1 / -1", fontSize: 12, color: "#b6bcc4" }}>{priced.perTonne.tonnes.toLocaleString("en-AU")} t of asphalt, supply and lay, with its share of trucks, crew and plant · total cost {money(priced.cost)}</div>
          </div>
        )}
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

      {msg && <p className={msg.ok ? "" : "error"} style={msg.ok ? { color: "var(--good)", fontWeight: 600 } : undefined} role="status">{msg.text}</p>}

      {canEdit && (
        <div style={{ position: "sticky", bottom: 0, background: "var(--ground)", padding: "10px 0 14px", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 8 }}>
          <button type="button" className="btn primary" disabled={busy !== null} onClick={() => save()}>{busy === "save" ? "Saving..." : dirty ? "Save changes" : "Saved"}</button>
          <button type="button" className="btn dark" disabled={busy !== null} onClick={() => void openSend()}>Send to customer</button>
          <button type="button" className="btn" disabled={busy !== null} onClick={() => save("print")}>{busy === "print" ? "Opening..." : "PDF / print"}</button>
          <Link className="btn" href={`/site/${quote.id}/overview`} style={{ textAlign: "center" }}>Job overview</Link>
          {hasSheet && <button type="button" className="btn" disabled={busy !== null} onClick={() => save("excel")}>{busy === "excel" ? "Making..." : "Excel"}</button>}
          {hasXero ? (
            <button type="button" className="btn" disabled={busy !== null} onClick={() => void toXero()}>
              {busy === "xero" ? "Sending to Xero..." : xeroNo ? `Update Xero ${xeroNo}` : "Send to Xero"}
            </button>
          ) : (
            <a className="btn" href="/setup#xero" style={{ textAlign: "center" }}>Connect Xero</a>
          )}
        </div>
      )}
      </div>
      {sending && (
        <SendQuoteDialog quoteId={quote.id} onClose={() => setSending(false)}
          onSent={(to) => { setSending(false); setMsg({ ok: true, text: `Quote sent to ${to.join(", ")}.` }); router.refresh(); }} />
      )}
    </div>
  );
}
