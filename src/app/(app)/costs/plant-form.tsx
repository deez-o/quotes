"use client";

import { useState } from "react";
import { PlaceSearch } from "../place-search";
import { archivePlant, savePlant } from "./actions";

export type PlantRow = { id: string; name: string; address: string | null; lat: number | null; lng: number | null };

const grid: React.CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 10, alignItems: "end" };
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
      <fieldset disabled={!canEdit} style={{ border: 0, padding: 0, margin: 0, ...grid }}>
        {plant && <input type="hidden" name="id" value={plant.id} />}
        <input type="hidden" name="place_source" value={source} />
        <label style={field}>Name<input type="text" name="name" value={name} onChange={(e) => setName(e.target.value)} required placeholder={plant ? "" : "Plant name"} /></label>
        <label style={{ ...field, gridColumn: "span 2" }}>Address<input type="text" name="address" value={address} onChange={(e) => { setAddress(e.target.value); setSource(""); setLat(""); setLng(""); }} placeholder="Street, suburb, state" /></label>
        <label style={field}>Latitude<input type="text" inputMode="decimal" name="lat" value={lat} onChange={(e) => { setLat(e.target.value); setSource("entered"); }} placeholder="found from address" /></label>
        <label style={field}>Longitude<input type="text" inputMode="decimal" name="lng" value={lng} onChange={(e) => { setLng(e.target.value); setSource("entered"); }} placeholder="found from address" /></label>
        {canEdit && (
          <div className="row" style={{ gap: 8 }}>
            <button type="submit" className={`btn${plant ? "" : " primary"}`} style={{ padding: "9px 14px" }}>{plant ? "Save" : "Add plant"}</button>
            {plant && !finding && <button type="button" className="btn" style={{ padding: "9px 14px" }} onClick={() => setFinding(true)}>Find on map</button>}
            {plant && <button formAction={archivePlant} className="btn" style={{ padding: "9px 14px" }}>Remove</button>}
          </div>
        )}
      </fieldset>
    </form>
  );
}
