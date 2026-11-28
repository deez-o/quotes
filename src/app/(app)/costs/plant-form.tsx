"use client";

import { useState } from "react";
import { PlaceSearch } from "../place-search";
import { archivePlant, savePlant } from "./actions";
import { AutoSave } from "../auto-save";

export type PlantRow = { id: string; name: string; address: string | null; lat: number | null; lng: number | null };

const field: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 4, fontSize: 13 };

/** A supply plant: find it on the map by name ("Downer Brendale"), or type the address. */
export function PlantForm({ plant, canEdit }: { plant?: PlantRow; canEdit: boolean }) {
  const [name, setName] = useState(plant?.name ?? "");
  const [address, setAddress] = useState(plant?.address ?? "");
  const [lat, setLat] = useState(plant?.lat?.toString() ?? "");
  const [lng, setLng] = useState(plant?.lng?.toString() ?? "");
  const [source, setSource] = useState<string>("");
  const [finding, setFinding] = useState(!plant);

  return (
    <form action={savePlant} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {canEdit && finding && (
        <PlaceSearch label={plant ? `Find ${plant.name} on the map` : "Find a plant on the map"} placeholder="e.g. Downer Brendale, Boral Narangba"
          onPick={(p) => {
            if (!name || !plant) setName(p.name);
            setAddress(p.address);
            setLat(String(p.lat));
            setLng(String(p.lng));
            setSource(p.source);
          }} />
      )}
      <fieldset disabled={!canEdit} style={{ border: 0, padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 10, minWidth: 0 }}>
        {plant && <input type="hidden" name="id" value={plant.id} />}
        <input type="hidden" name="place_source" value={source} />
        {plant && canEdit && <AutoSave watch={[lat, lng]} />}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
          <label style={{ ...field, flex: "1 1 220px", minWidth: 0 }}>Name<input type="text" name="name" value={name} onChange={(e) => setName(e.target.value)} required placeholder={plant ? "" : "Plant name"} /></label>
          <label style={{ ...field, flex: "2 1 300px", minWidth: 0 }}>Address<input type="text" name="address" value={address} onChange={(e) => { setAddress(e.target.value); setSource(""); setLat(""); setLng(""); }} placeholder="Street, suburb, state" /></label>
        </div>
        <span className="sub" style={{ marginTop: 0, fontSize: 13, color: lat && lng ? "var(--good)" : undefined }}>
          {lat && lng ? "✓ On the map. Cartage is worked out from here." : "Not on the map yet. Use Find on the map, or save and quoteout finds it from the address."}
        </span>
        <details>
          <summary className="sub" style={{ marginTop: 0, fontSize: 13, cursor: "pointer" }}>Enter the location by hand (latitude and longitude)</summary>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 8 }}>
            <label style={{ ...field, flex: "1 1 140px" }}>Latitude<input type="text" inputMode="decimal" name="lat" value={lat} onChange={(e) => { setLat(e.target.value); setSource("entered"); }} placeholder="e.g. -27.19" /></label>
            <label style={{ ...field, flex: "1 1 140px" }}>Longitude<input type="text" inputMode="decimal" name="lng" value={lng} onChange={(e) => { setLng(e.target.value); setSource("entered"); }} placeholder="e.g. 152.99" /></label>
          </div>
        </details>
        {canEdit && (
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            {!plant && <button type="submit" className="btn primary" style={{ padding: "9px 14px" }}>Add plant</button>}
            {plant && !finding && <button type="button" className="btn" style={{ padding: "9px 14px" }} onClick={() => setFinding(true)}>Find on the map</button>}
            {plant && <button formAction={archivePlant} className="btn" style={{ padding: "9px 14px", marginLeft: "auto" }}>Remove plant</button>}
          </div>
        )}
      </fieldset>
    </form>
  );
}
