"use client";
/* eslint-disable @next/next/no-img-element -- Street View comes through our own route */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { buildOverview } from "./actions";

/** Street View looking four ways from the site; views Google doesn't have are hidden. */
export function StreetViews({ quoteId }: { quoteId: string }) {
  const [gone, setGone] = useState<number[]>([]);
  const views = [{ h: 0, label: "North" }, { h: 90, label: "East" }, { h: 180, label: "South" }, { h: 270, label: "West" }].filter((v) => !gone.includes(v.h));
  if (!views.length) return <p className="sub">Google has no Street View at this address.</p>;
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 8 }}>
      {views.map((v) => (
        <figure key={v.h} style={{ margin: 0 }}>
          <a href={`/api/quotes/${quoteId}/streetview?h=${v.h}`} target="_blank" rel="noreferrer">
            <img src={`/api/quotes/${quoteId}/streetview?h=${v.h}`} alt={`Street View looking ${v.label.toLowerCase()}`} loading="lazy"
              onError={() => setGone((g) => [...g, v.h])} style={{ width: "100%", aspectRatio: "16 / 10", objectFit: "cover", borderRadius: 8, display: "block" }} />
          </a>
          <figcaption className="sub" style={{ marginTop: 2 }}>Looking {v.label.toLowerCase()}</figcaption>
        </figure>
      ))}
    </div>
  );
}

export function BuildOverviewButton({ quoteId, again }: { quoteId: string; again: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <div>
      <button type="button" className={again ? "btn" : "btn primary"} disabled={busy} onClick={async () => {
        setBusy(true); setErr(null);
        const r = await buildOverview({ id: quoteId });
        setBusy(false);
        if (!r.ok) setErr(r.message); else router.refresh();
      }}>{busy ? "Reading the documents..." : again ? "Read the specs again" : "Read the specs"}</button>
      {err && <p className="error" role="status">{err}</p>}
    </div>
  );
}
