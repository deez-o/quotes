"use client";
/* eslint-disable @typescript-eslint/no-explicit-any -- the Google Maps script has no types installed here */

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { polygonArea, type DrawnArea } from "@/lib/rfq/overview";
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

export function AreaMap({ quoteId, center, initial, items, canEdit, browserKey }: {
  quoteId: string; center: { lat: number; lng: number }; initial: DrawnArea[]; items: Item[]; canEdit: boolean; browserKey: string | null;
}) {
  const router = useRouter();
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<any>(null);
  const shapes = useRef(new Map<string, any>());
  const draft = useRef<{ line: any; points: [number, number][] } | null>(null);
  const [areas, setAreas] = useState<DrawnArea[]>(initial);
  const [drawing, setDrawing] = useState(false);
  const [draftCount, setDraftCount] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [failed, setFailed] = useState<string | null>(browserKey ? null : "The map isn't set up yet (no browser Maps key).");
  const [pick, setPick] = useState<Record<string, string>>({});

  const pathOf = (poly: any): [number, number][] => poly.getPath().getArray().map((p: any) => [p.lat(), p.lng()] as [number, number]);

  const addShape = useCallback((g: any, a: DrawnArea) => {
    const poly = new g.maps.Polygon({
      paths: a.path.map(([lat, lng]) => ({ lat, lng })), map: map.current, editable: canEdit, strokeColor: a.color, strokeWeight: 2, fillColor: a.color, fillOpacity: 0.3,
    });
    const sync = () => {
      const path = pathOf(poly);
      setAreas((all) => all.map((x) => (x.id === a.id ? { ...x, path, m2: Math.round(polygonArea(path)) } : x)));
      setDirty(true);
    };
    const p = poly.getPath();
    ["set_at", "insert_at", "remove_at"].forEach((ev) => p.addListener(ev, sync));
    shapes.current.set(a.id, poly);
  }, [canEdit]);

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
      map.current.addListener("click", (e: any) => {
        const d = draft.current;
        if (!d) return;
        d.points.push([e.latLng.lat(), e.latLng.lng()]);
        d.line.setPath(d.points.map(([lat, lng]) => ({ lat, lng })));
        setDraftCount(d.points.length);
      });
    }).catch((e) => setFailed(e instanceof Error ? e.message : "The map didn't load."));
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the map is made once
  }, [browserKey]);

  function startDraw() {
    const g = (window as any).google;
    if (!g || !map.current) return;
    const color = COLORS[areas.length % COLORS.length];
    draft.current = { line: new g.maps.Polyline({ map: map.current, strokeColor: color, strokeWeight: 2, clickable: false }), points: [] };
    map.current.setOptions({ draggableCursor: "crosshair" });
    setDrawing(true); setDraftCount(0); setMsg(null);
  }
  function stopDraw() {
    draft.current?.line.setMap(null);
    draft.current = null;
    map.current?.setOptions({ draggableCursor: null });
    setDrawing(false); setDraftCount(0);
  }
  function undoPoint() {
    const d = draft.current;
    if (!d) return;
    d.points.pop();
    d.line.setPath(d.points.map(([lat, lng]) => ({ lat, lng })));
    setDraftCount(d.points.length);
  }
  function finish() {
    const d = draft.current;
    const g = (window as any).google;
    if (!d || d.points.length < 3 || !g) return;
    const id = `a${Date.now().toString(36)}`;
    const a: DrawnArea = { id, name: `Area ${areas.length + 1}`, path: d.points, m2: Math.round(polygonArea(d.points)), color: COLORS[areas.length % COLORS.length] };
    stopDraw();
    addShape(g, a);
    setAreas((all) => [...all, a]);
    setDirty(true);
  }
  function remove(id: string) {
    shapes.current.get(id)?.setMap(null);
    shapes.current.delete(id);
    setAreas((all) => all.filter((a) => a.id !== id));
    setDirty(true);
  }
  function rename(id: string, name: string) {
    setAreas((all) => all.map((a) => (a.id === id ? { ...a, name } : a)));
    setDirty(true);
  }

  async function save() {
    setBusy("save"); setMsg(null);
    const r = await saveAreas({ id: quoteId, areas });
    setBusy(null);
    if (!r.ok) return setMsg({ ok: false, text: r.message });
    setDirty(false);
    setMsg({ ok: true, text: "Areas saved." });
  }
  async function applyTo(a: DrawnArea) {
    const itemKey = pick[a.id] ?? items[0]?.key;
    if (!itemKey) return;
    setBusy(a.id); setMsg(null);
    if (dirty) {
      const s = await saveAreas({ id: quoteId, areas });
      if (!s.ok) { setBusy(null); return setMsg({ ok: false, text: s.message }); }
      setDirty(false);
    }
    const r = await applyArea({ id: quoteId, itemKey, m2: a.m2 });
    setBusy(null);
    if (!r.ok) return setMsg({ ok: false, text: r.message });
    const label = items.find((i) => i.key === itemKey)?.label ?? "the item";
    setMsg({ ok: true, text: `${m2(a.m2)} put into ${label}. Quote now $${Math.round(r.total).toLocaleString("en-AU")} ex GST.` });
    router.refresh();
  }

  const total = areas.reduce((s, a) => s + a.m2, 0);

  return (
    <section className="card">
      <div className="row" style={{ justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8 }}>
        <strong>Measure on the map</strong>
        {areas.length > 0 && <span className="sub">{areas.length} area{areas.length === 1 ? "" : "s"}, {m2(total)} in all</span>}
      </div>
      <p className="sub" style={{ margin: "4px 0 10px" }}>Trace each area on the satellite view. Click its corners, then Finish. Drag the white dots to adjust.</p>
      {failed ? (
        <p className="error">{failed}</p>
      ) : (
        <div ref={box} style={{ width: "100%", height: 460, borderRadius: 10, overflow: "hidden", background: "#e9ecef" }} aria-label="Satellite map of the job site" />
      )}

      {canEdit && !failed && (
        <div className="row" style={{ gap: 8, marginTop: 10, flexWrap: "wrap" }}>
          {drawing ? (
            <>
              <button type="button" className="btn primary" disabled={draftCount < 3} onClick={finish}>Finish area{draftCount ? ` (${draftCount} points)` : ""}</button>
              <button type="button" className="btn" disabled={!draftCount} onClick={undoPoint}>Undo point</button>
              <button type="button" className="btn" onClick={stopDraw}>Cancel</button>
            </>
          ) : (
            <button type="button" className="btn primary" onClick={startDraw}>Draw an area</button>
          )}
          {dirty && !drawing && <button type="button" className="btn" disabled={busy !== null} onClick={() => void save()}>{busy === "save" ? "Saving..." : "Save areas"}</button>}
        </div>
      )}

      {areas.length > 0 && (
        <div style={{ display: "grid", gap: 8, marginTop: 12 }}>
          {areas.map((a) => (
            <div key={a.id} className="row" style={{ gap: 8, alignItems: "center", flexWrap: "wrap", padding: "8px 10px", border: "1px solid var(--line, #e1e4e8)", borderRadius: 8 }}>
              <span aria-hidden style={{ width: 14, height: 14, borderRadius: 3, background: a.color, flex: "none" }} />
              <input aria-label="Area name" value={a.name} disabled={!canEdit} onChange={(e) => rename(a.id, e.target.value)} style={{ flex: "1 1 140px", minWidth: 0 }} />
              <strong style={{ minWidth: 90, textAlign: "right" }}>{m2(a.m2)}</strong>
              {canEdit && items.length > 0 && (
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
