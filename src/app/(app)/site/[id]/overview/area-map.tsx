"use client";
/* eslint-disable @typescript-eslint/no-explicit-any -- the Google Maps script has no types installed here */

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { lineLength, polygonArea, type DrawnArea, type PlanOverlay } from "@/lib/rfq/overview";
import { groundWidthM, parseScale } from "@/lib/rfq/plan-scale";
import { createPlanOverlay, renderPlan, type OverlayHandle } from "./plan-overlay";
import { saveAreas, applyAreaToItem as applyArea } from "./actions";

const COLORS = ["#FF6A13", "#2F80ED", "#27AE60", "#EB5757", "#9B51E0", "#F2C94C"];
type Item = { key: string; label: string; area: number | null };

let loading: Promise<any> | null = null;
function loadMaps(key: string): Promise<any> {
  const w = window as any;
  if (w.google?.maps?.Map) return Promise.resolve(w.google);
  if (!loading) {
    loading = new Promise((resolve, reject) => {
      w.__qoMapsReady = () => resolve(w.google);
      const s = document.createElement("script");
      s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&v=weekly&loading=async&callback=__qoMapsReady`;
      s.async = true;
      s.onerror = () => { loading = null; reject(new Error("Google Maps didn't load.")); };
      document.head.appendChild(s);
    });
  }
  return loading;
}

const m2 = (n: number) => `${Math.round(n).toLocaleString("en-AU")} m²`;

export function AreaMap({ quoteId, center, initial, items, canEdit, browserKey, onUse, bare = false, plans = [], initialOverlay = null }: {
  quoteId: string; center: { lat: number; lng: number }; initial: DrawnArea[]; items: Item[]; canEdit: boolean; browserKey: string | null;
  /** The RFQ's drawings, to lay on the map. */
  plans?: { name: string; url: string | null }[];
  initialOverlay?: PlanOverlay | null;
  /** In the quote editor: put the area into the item there (saved with the quote) instead of saving it straight away. */
  onUse?: (itemKey: string, m2: number) => void;
  /** Leave out the card and heading (when it sits inside another section). */
  bare?: boolean;
}) {
  const router = useRouter();
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<any>(null);
  const shapes = useRef(new Map<string, any>());
  const draft = useRef<{ poly: any; dots: any[]; points: [number, number][]; color: string; line: boolean } | null>(null);
  const labels = useRef(new Map<string, any>());
  const [areas, setAreas] = useState<DrawnArea[]>(initial);
  const [drawing, setDrawing] = useState(false);
  const [draftCount, setDraftCount] = useState(0);
  const [draftM2, setDraftM2] = useState(0);
  const [drawKind, setDrawKind] = useState<"area" | "line">("area");
  const [overlay, setOverlay] = useState<PlanOverlay | null>(initialOverlay);
  const [planLocked, setPlanLocked] = useState(true);
  const [planBusy, setPlanBusy] = useState<string | null>(null);
  const [planPages, setPlanPages] = useState(1);
  const [planFile, setPlanFile] = useState(initialOverlay?.file ?? "");
  const [askScale, setAskScale] = useState(false);
  const planImg = useRef<{ url: string; aspect: number; widthPt: number; heightPt: number } | null>(null);
  const planHandle = useRef<OverlayHandle | null>(null);
  const viewable = plans.filter((f) => f.url && /\.(pdf|png|jpe?g|webp)$/i.test(f.name));
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [failed, setFailed] = useState<string | null>(browserKey ? null : "The map isn't set up yet (no browser Maps key).");
  const [pick, setPick] = useState<Record<string, string>>({});

  const pathOf = (poly: any): [number, number][] => poly.getPath().getArray().map((p: any) => [p.lat(), p.lng()] as [number, number]);

  /** A label on the map with the area's name and size, at its middle. */
  const setLabel = useCallback((a: DrawnArea) => {
    const g = (window as any).google;
    if (!g || !map.current || a.path.length < (a.kind === "line" ? 2 : 3)) return;
    let lat: number, lng: number;
    if (a.kind === "line") {
      // Middle of the line: halfway along its middle segment.
      const i = Math.max(1, Math.floor(a.path.length / 2));
      lat = (a.path[i - 1][0] + a.path[i][0]) / 2; lng = (a.path[i - 1][1] + a.path[i][1]) / 2;
    } else {
      lat = a.path.reduce((s2, p) => s2 + p[0], 0) / a.path.length;
      lng = a.path.reduce((s2, p) => s2 + p[1], 0) / a.path.length;
    }
    const text = a.kind === "line" ? `${(a.length_m ?? lineLength(a.path)).toFixed(1)} m` : `${a.name} · ${Math.round(a.m2).toLocaleString("en-AU")} m²`;
    const opts = { position: { lat, lng }, label: { text, color: "#ffffff", fontWeight: "700", fontSize: "13px" }, icon: { path: g.maps.SymbolPath.CIRCLE, scale: 0 }, clickable: false };
    const m = labels.current.get(a.id);
    if (m) m.setOptions(opts); else labels.current.set(a.id, new g.maps.Marker({ ...opts, map: map.current }));
  }, []);

  const addShape = useCallback((g: any, a: DrawnArea) => {
    const isLine = a.kind === "line";
    const poly = isLine
      ? new g.maps.Polyline({ path: a.path.map(([lat, lng]) => ({ lat, lng })), map: map.current, editable: canEdit, strokeColor: "#FFEB3B", strokeWeight: 4,
        icons: [{ icon: { path: g.maps.SymbolPath.FORWARD_CLOSED_ARROW, scale: 3 }, offset: "0%" }, { icon: { path: g.maps.SymbolPath.FORWARD_CLOSED_ARROW, scale: 3 }, offset: "100%" }] })
      : new g.maps.Polygon({
        paths: a.path.map(([lat, lng]) => ({ lat, lng })), map: map.current, editable: canEdit, strokeColor: a.color, strokeWeight: 3, fillColor: a.color, fillOpacity: 0.35,
      });
    let current = a;
    setLabel(a);
    const sync = () => {
      const path = pathOf(poly);
      setAreas((all) => all.map((x) => {
        if (x.id !== a.id) return x;
        current = isLine ? { ...x, path, length_m: Math.round(lineLength(path) * 10) / 10 } : { ...x, path, m2: Math.round(polygonArea(path)) };
        setLabel(current);
        return current;
      }));
      setDirty(true);
    };
    void current;
    const p = poly.getPath();
    ["set_at", "insert_at", "remove_at"].forEach((ev) => p.addListener(ev, sync));
    shapes.current.set(a.id, poly);
  }, [canEdit, setLabel]);

  useEffect(() => {
    if (!browserKey || !box.current) return;
    let cancelled = false;
    loadMaps(browserKey).then((g) => {
      if (cancelled || !box.current) return;
      map.current = new g.maps.Map(box.current, {
        center, zoom: 19, mapTypeId: "satellite", tilt: 0, rotateControl: false, streetViewControl: false, fullscreenControl: true, clickableIcons: false, gestureHandling: "greedy",
      });
      new g.maps.Marker({ position: center, map: map.current, title: "Job site" });
      initial.forEach((a) => addShape(g, a));
      if (initial.length) {
        const b = new g.maps.LatLngBounds();
        initial.forEach((a) => a.path.forEach(([lat, lng]) => b.extend({ lat, lng })));
        map.current.fitBounds(b, 40);
      }
      map.current.addListener("click", (e: any) => addPoint(g, e.latLng.lat(), e.latLng.lng()));
      if (initialOverlay && plans.some((f) => f.name === initialOverlay.file && f.url)) void placePlan(initialOverlay.file, initialOverlay.page, initialOverlay);
    }).catch((e) => setFailed(e instanceof Error ? e.message : "The map didn't load."));
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the map is made once
  }, [browserKey]);

  function redrawDraft() {
    const d = draft.current;
    if (!d) return;
    d.poly.setPath(d.points.map(([lat, lng]) => ({ lat, lng })));
    setDraftCount(d.points.length);
    setDraftM2(d.line ? Math.round(lineLength(d.points) * 10) / 10 : d.points.length >= 3 ? Math.round(polygonArea(d.points)) : 0);
  }
  function addPoint(g: any, lat: number, lng: number) {
    const d = draft.current;
    if (!d) return;
    d.points.push([lat, lng]);
    const first = d.points.length === 1;
    const dot = new g.maps.Marker({
      position: { lat, lng }, map: map.current, zIndex: first ? 1000 : 999,
      icon: { path: g.maps.SymbolPath.CIRCLE, scale: first ? 11 : 8, fillColor: first ? "#ffffff" : d.color, fillOpacity: 1, strokeColor: first ? d.color : "#ffffff", strokeWeight: 3 },
      title: first ? "Tap here to finish" : undefined,
    });
    // Tapping the first corner again closes the area.
    if (first && !d.line) dot.addListener("click", () => { if ((draft.current?.points.length ?? 0) >= 3) finish(); });
    d.dots.push(dot);
    redrawDraft();
  }
  function startDraw(kind: "area" | "line" = "area") {
    const g = (window as any).google;
    if (!g || !map.current) return;
    const line = kind === "line";
    const color = line ? "#FFEB3B" : COLORS[areas.filter((a) => a.kind !== "line").length % COLORS.length];
    draft.current = {
      poly: line
        ? new g.maps.Polyline({ map: map.current, strokeColor: color, strokeWeight: 4, clickable: false, zIndex: 900 })
        : new g.maps.Polygon({ map: map.current, strokeColor: color, strokeWeight: 3, fillColor: color, fillOpacity: 0.3, clickable: false, zIndex: 900 }),
      dots: [], points: [], color, line,
    };
    setDrawKind(kind);
    // Taps inside areas already drawn must add corners, not select the area.
    shapes.current.forEach((p) => p.setOptions({ clickable: false, editable: false }));
    map.current.setOptions({ draggableCursor: "crosshair" });
    setDrawing(true); setDraftCount(0); setDraftM2(0); setMsg(null);
  }
  function stopDraw() {
    draft.current?.poly.setMap(null);
    draft.current?.dots.forEach((m) => m.setMap(null));
    draft.current = null;
    shapes.current.forEach((p) => p.setOptions({ clickable: true, editable: canEdit }));
    map.current?.setOptions({ draggableCursor: null });
    setDrawing(false); setDraftCount(0); setDraftM2(0);
  }
  function undoPoint() {
    const d = draft.current;
    if (!d || !d.points.length) return;
    d.points.pop();
    d.dots.pop()?.setMap(null);
    redrawDraft();
  }
  function finish() {
    const d = draft.current;
    const g = (window as any).google;
    if (!d || d.points.length < (d.line ? 2 : 3) || !g) return;
    const id = `a${Date.now().toString(36)}`;
    const a: DrawnArea = d.line
      ? { id, kind: "line", name: `Measure ${areas.filter((x) => x.kind === "line").length + 1}`, path: [...d.points], m2: 0, length_m: Math.round(lineLength(d.points) * 10) / 10, color: d.color }
      : { id, name: `Area ${areas.filter((x) => x.kind !== "line").length + 1}`, path: [...d.points], m2: Math.round(polygonArea(d.points)), color: d.color };
    stopDraw();
    addShape(g, a);
    setAreas((all) => [...all, a]);
    setDirty(true);
  }
  function remove(id: string) {
    shapes.current.get(id)?.setMap(null);
    shapes.current.delete(id);
    labels.current.get(id)?.setMap(null);
    labels.current.delete(id);
    setAreas((all) => all.filter((a) => a.id !== id));
    setDirty(true);
  }
  function rename(id: string, name: string) {
    setAreas((all) => all.map((a) => {
      if (a.id !== id) return a;
      const next = { ...a, name };
      setLabel(next);
      return next;
    }));
    setDirty(true);
  }

  async function save() {
    setBusy("save"); setMsg(null);
    const r = await saveAreas({ id: quoteId, areas, overlay });
    setBusy(null);
    if (!r.ok) return setMsg({ ok: false, text: r.message });
    setDirty(false);
    setMsg({ ok: true, text: "Areas saved." });
  }
  // Saves on its own a moment after an area is finished, moved, renamed or deleted.
  const saveRef = useRef(save);
  useEffect(() => { saveRef.current = save; });
  useEffect(() => {
    if (!dirty || drawing || !canEdit) return;
    const t = setTimeout(() => void saveRef.current(), 1200);
    return () => clearTimeout(t);
  }, [areas, overlay, dirty, drawing, canEdit]);
  async function applyTo(a: DrawnArea) {
    const itemKey = pick[a.id] ?? items[0]?.key;
    if (!itemKey) return;
    setBusy(a.id); setMsg(null);
    if (dirty) {
      const s = await saveAreas({ id: quoteId, areas });
      if (!s.ok) { setBusy(null); return setMsg({ ok: false, text: s.message }); }
      setDirty(false);
    }
    const label = items.find((i) => i.key === itemKey)?.label ?? "the item";
    if (onUse) {
      onUse(itemKey, a.m2);
      setBusy(null);
      return setMsg({ ok: true, text: `${m2(a.m2)} put into ${label}. Save the quote to keep it.` });
    }
    const r = await applyArea({ id: quoteId, itemKey, m2: a.m2 });
    setBusy(null);
    if (!r.ok) return setMsg({ ok: false, text: r.message });
    setMsg({ ok: true, text: `${m2(a.m2)} put into ${label}. Quote now $${Math.round(r.total).toLocaleString("en-AU")} ex GST.` });
    router.refresh();
  }

  // ---- The drawing on the map ----
  async function placePlan(file: string, page: number, keep: PlanOverlay | null = null) {
    const g = (window as any).google;
    const f = viewable.find((x) => x.name === file);
    if (!g || !map.current || !f?.url) return;
    setPlanBusy("Putting the drawing on the map..."); setMsg(null);
    try {
      const r = await renderPlan(f.url, f.name, page);
      planImg.current = { url: r.url, aspect: r.aspect, widthPt: r.widthPt, heightPt: r.heightPt };
      setPlanPages(r.pages); setPlanFile(file);
      let next: PlanOverlay;
      if (keep) next = keep;
      else {
        const sc = parseScale(r.text);
        const c = map.current.getCenter();
        next = { file, page, lat: c.lat(), lng: c.lng(), rotation: 0, widthM: sc ? groundWidthM(sc, r.widthPt, r.heightPt) : 200, opacity: 0.6, ratio: sc?.ratio ?? null, sheet: sc?.sheet ?? null };
        setAskScale(!sc);
        setPlanLocked(false);
        setDirty(true);
        setMsg({ ok: true, text: sc ? `Scale 1:${sc.ratio}${sc.sheet ? ` at ${sc.sheet}` : ""} read off the drawing. Drag it into place, turn it to line up, then lock it.` : "Couldn't find the scale on the drawing: enter it below, then drag it into place." });
      }
      planHandle.current?.remove();
      planHandle.current = createPlanOverlay(g, map.current, planImg.current, next, keep ? true : false, (lat, lng) => { setOverlay((o) => (o ? { ...o, lat, lng } : o)); setDirty(true); });
      setOverlay(next);
    } catch (e) {
      setMsg({ ok: false, text: `Couldn't show that drawing: ${e instanceof Error ? e.message : "error"}` });
    } finally {
      setPlanBusy(null);
    }
  }
  useEffect(() => { if (overlay) planHandle.current?.update(overlay, planLocked || drawing); }, [overlay, planLocked, drawing]);
  const setPlan = (patch: Partial<PlanOverlay>) => { setOverlay((o) => (o ? { ...o, ...patch } : o)); setDirty(true); };
  const removePlan = () => { planHandle.current?.remove(); planHandle.current = null; setOverlay(null); setDirty(true); };

  const total = areas.filter((a) => a.kind !== "line").reduce((s, a) => s + a.m2, 0);
  const areaCount = areas.filter((a) => a.kind !== "line").length;

  return (
    <section className={bare ? undefined : "card"}>
      <div className="row" style={{ justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8 }}>
        {!bare && <strong>Measure on the map</strong>}
        {areaCount > 0 && <span className="sub">{areaCount} area{areaCount === 1 ? "" : "s"}, {m2(total)} in all</span>}
      </div>
      {drawing ? (
        <p role="status" style={{ margin: "4px 0 10px", padding: "8px 10px", borderRadius: 8, background: "var(--accent-soft, #eef4fd)", fontWeight: 600 }}>
          {drawKind === "line" ? (draftCount === 0 ? "Tap where the measurement starts (e.g. one side of the island)." : draftCount === 1 ? "Now tap where it ends." : `${draftM2.toFixed(1)} m. Tap more points to follow a bend, or press Finish.`) : <>
          {draftCount === 0 && "Tap the first corner of the area."}
          {draftCount === 1 && "Now tap the next corner."}
          {draftCount === 2 && "Keep tapping corners. The shape fills in from the third."}
          {draftCount >= 3 && `${draftCount} corners · ${m2(draftM2)}. Tap the big white dot or Finish when done.`}</>}
        </p>
      ) : (
        <p className="sub" style={{ margin: "4px 0 10px" }}>Press Draw an area, then tap each corner on the satellite view. Measure a distance shows widths and lengths. Drag the white dots to adjust after.{viewable.length ? " Put a drawing on the map to trace over the plan." : ""}</p>
      )}
      {failed ? (
        <p className="error">{failed}</p>
      ) : (
        <div ref={box} style={{ width: "100%", height: 460, borderRadius: 10, overflow: "hidden", background: "#e9ecef" }} aria-label="Satellite map of the job site" />
      )}

      {canEdit && !failed && (
        <div className="row" style={{ gap: 8, marginTop: 10, flexWrap: "wrap" }}>
          {drawing ? (
            <>
              <button type="button" className="btn primary" style={{ minHeight: 44 }} disabled={draftCount < (drawKind === "line" ? 2 : 3)} onClick={finish}>Finish</button>
              <button type="button" className="btn" style={{ minHeight: 44 }} disabled={!draftCount} onClick={undoPoint}>Undo last point</button>
              <button type="button" className="btn" style={{ minHeight: 44 }} onClick={stopDraw}>Cancel</button>
            </>
          ) : (
            <>
              <button type="button" className="btn primary" style={{ minHeight: 44 }} onClick={() => startDraw("area")}>Draw an area</button>
              <button type="button" className="btn" style={{ minHeight: 44 }} onClick={() => startDraw("line")}>Measure a distance</button>
            </>
          )}
          {busy === "save" && <span className="sub" style={{ marginTop: 0, alignSelf: "center" }}>Saving...</span>}
        </div>
      )}

      {canEdit && !failed && viewable.length > 0 && !drawing && (
        <div style={{ marginTop: 10, padding: 10, border: "1px solid var(--line, #e1e4e8)", borderRadius: 8, display: "flex", flexDirection: "column", gap: 8 }}>
          <div className="row" style={{ gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <strong style={{ fontSize: 14 }}>Drawing on the map</strong>
            <select value={planFile} onChange={(e) => setPlanFile(e.target.value)} style={{ flex: "1 1 200px", minWidth: 0 }} aria-label="Drawing">
              <option value="">Choose a drawing...</option>
              {viewable.map((f) => <option key={f.name} value={f.name}>{f.name}</option>)}
            </select>
            {planPages > 1 && overlay && (
              <label style={{ fontSize: 13, display: "flex", gap: 4, alignItems: "center" }}>Page
                <select value={overlay.page} onChange={(e) => void placePlan(overlay.file, Number(e.target.value))}>
                  {Array.from({ length: planPages }, (_, i) => <option key={i + 1} value={i + 1}>{i + 1}</option>)}
                </select>
              </label>
            )}
            <button type="button" className="btn" disabled={!planFile || planBusy !== null} onClick={() => void placePlan(planFile, 1)}>{overlay ? "Show this one" : "Put it on the map"}</button>
            {overlay && <button type="button" className="btn" onClick={removePlan}>Take it off</button>}
          </div>
          {planBusy && <span className="sub" style={{ marginTop: 0 }}>{planBusy}</span>}
          {overlay && (
            <>
              <div className="row" style={{ gap: 12, alignItems: "center", flexWrap: "wrap", fontSize: 13 }}>
                <button type="button" className={`btn${planLocked ? "" : " primary"}`} onClick={() => setPlanLocked((l) => !l)}>{planLocked ? "Move the drawing" : "Lock it in place"}</button>
                <label style={{ display: "flex", gap: 6, alignItems: "center" }}>Turn
                  <input type="range" min={-180} max={180} step={0.5} value={overlay.rotation} onChange={(e) => setPlan({ rotation: Number(e.target.value) })} style={{ width: 140 }} />
                  <span style={{ minWidth: 40 }}>{overlay.rotation}°</span>
                </label>
                <label style={{ display: "flex", gap: 6, alignItems: "center" }}>See-through
                  <input type="range" min={0.15} max={1} step={0.05} value={overlay.opacity} onChange={(e) => setPlan({ opacity: Number(e.target.value) })} style={{ width: 100 }} />
                </label>
              </div>
              <div className="row" style={{ gap: 8, alignItems: "center", flexWrap: "wrap", fontSize: 13 }}>
                <span>Scale 1:</span>
                <input type="text" inputMode="numeric" defaultValue={overlay.ratio ?? ""} key={`r${overlay.ratio}`} style={{ width: 70 }} aria-label="Scale"
                  onBlur={(e) => { const ratio = Number(e.target.value); if (ratio > 0 && planImg.current) setPlan({ ratio, widthM: groundWidthM({ ratio, sheet: (overlay.sheet as "A1" | null) ?? null }, planImg.current.widthPt, planImg.current.heightPt) }); }} />
                <span>at</span>
                <select value={overlay.sheet ?? ""} aria-label="Sheet size" onChange={(e) => { const sheet = (e.target.value || null) as "A1" | null; if (planImg.current && overlay.ratio) setPlan({ sheet, widthM: groundWidthM({ ratio: overlay.ratio, sheet }, planImg.current.widthPt, planImg.current.heightPt) }); else setPlan({ sheet }); }}>
                  <option value="">this page</option>
                  {["A0", "A1", "A2", "A3", "A4"].map((x) => <option key={x} value={x}>{x}</option>)}
                </select>
                <span className="sub" style={{ marginTop: 0 }}>· {Math.round(overlay.widthM)} m across</span>
                <button type="button" className="btn" style={{ padding: "4px 8px" }} onClick={() => setPlan({ widthM: overlay.widthM * 0.99 })} aria-label="Slightly smaller">−</button>
                <button type="button" className="btn" style={{ padding: "4px 8px" }} onClick={() => setPlan({ widthM: overlay.widthM * 1.01 })} aria-label="Slightly bigger">+</button>
                {askScale && <span className="error" style={{ marginTop: 0 }}>Enter the scale from the title block.</span>}
              </div>
            </>
          )}
        </div>
      )}

      {areas.length > 0 && (
        <div style={{ display: "grid", gap: 8, marginTop: 12 }}>
          {areas.map((a) => (
            <div key={a.id} className="row" style={{ gap: 8, alignItems: "center", flexWrap: "wrap", padding: "8px 10px", border: "1px solid var(--line, #e1e4e8)", borderRadius: 8 }}>
              <span aria-hidden style={{ width: 14, height: 14, borderRadius: 3, background: a.color, flex: "none" }} />
              <input aria-label="Area name" value={a.name} disabled={!canEdit} onChange={(e) => rename(a.id, e.target.value)} style={{ flex: "1 1 140px", minWidth: 0 }} />
              <strong style={{ minWidth: 90, textAlign: "right" }}>{a.kind === "line" ? `${(a.length_m ?? 0).toFixed(1)} m` : m2(a.m2)}</strong>
              {canEdit && items.length > 0 && a.kind !== "line" && (
                <>
                  <select aria-label="Quote item" value={pick[a.id] ?? items[0].key} onChange={(e) => setPick((p) => ({ ...p, [a.id]: e.target.value }))} style={{ flex: "1 1 180px", minWidth: 0 }}>
                    {items.map((i) => <option key={i.key} value={i.key}>{i.label}{i.area ? ` (now ${m2(i.area)})` : ""}</option>)}
                  </select>
                  <button type="button" className="btn" disabled={busy !== null} onClick={() => void applyTo(a)}>{busy === a.id ? "Using..." : "Use this area"}</button>
                </>
              )}
              {canEdit && <button type="button" className="btn" onClick={() => remove(a.id)} aria-label={`Delete ${a.name}`}>Delete</button>}
            </div>
          ))}
        </div>
      )}
      {msg && <p className={msg.ok ? "" : "error"} style={msg.ok ? { color: "var(--good)", fontWeight: 600, marginTop: 10 } : { marginTop: 10 }} role="status">{msg.text}</p>}
    </section>
  );
}
