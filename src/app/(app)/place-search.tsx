"use client";

import { useState } from "react";
import type { Place } from "@/lib/maps";
import { findPlaces } from "./maps-actions";

/** Search box that finds a business or address ("Downer Brendale") and hands back the pick. */
export function PlaceSearch({ onPick, placeholder, near, label = "Search the map" }: {
  onPick: (p: Place) => void; placeholder?: string; near?: { lat: number; lng: number } | null; label?: string;
}) {
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [hits, setHits] = useState<Place[] | null>(null);
  const [note, setNote] = useState<string | null>(null);

  async function go() {
    if (q.trim().length < 3) return;
    setBusy(true);
    setNote(null);
    const r = await findPlaces(q, near ?? null);
    setBusy(false);
    if (!r.ok) { setHits([]); setNote(r.message); return; }
    setHits(r.places);
    if (!r.places.length) setNote(r.google ? "Nothing found. Try the suburb too." : "Nothing found. Try a street address and suburb (business names need the Google search switched on).");
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div className="row" style={{ gap: 8, flexWrap: "nowrap" }}>
        <input type="search" aria-label={label} value={q} placeholder={placeholder ?? "e.g. Downer Brendale"} style={{ flex: 1, minWidth: 0 }}
          onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void go(); } }} />
        <button type="button" className="btn" disabled={busy || q.trim().length < 3} onClick={() => void go()}>{busy ? "Finding..." : "Find"}</button>
      </div>
      {note && <p className="sub" style={{ margin: 0, fontSize: 13 }}>{note}</p>}
      {hits && hits.length > 0 && (
        <ul style={{ listStyle: "none", margin: 0, padding: 0, border: "1px solid var(--line-soft)", borderRadius: 8, background: "#fff" }}>
          {hits.map((h, i) => (
            <li key={`${h.lat},${h.lng},${i}`} style={{ borderTop: i ? "1px solid var(--line-soft)" : 0 }}>
              <button type="button" onClick={() => { onPick(h); setHits(null); setQ(""); }}
                style={{ all: "unset", cursor: "pointer", display: "block", width: "100%", boxSizing: "border-box", padding: "10px 12px" }}>
                <strong style={{ display: "block" }}>{h.name}</strong>
                <span className="sub" style={{ fontSize: 13, marginTop: 0 }}>{h.address}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
