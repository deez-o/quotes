"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { buildSiteQuote } from "../actions";
import { useDictation } from "../dictation";

type Photo = { path: string; preview: string };

/** Shrink a photo to max 1600 px JPEG before upload: faster on site, cheaper for the AI. */
async function shrink(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) return file;
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b ?? file), "image/jpeg", 0.8));
}

export function TalkToQuote({ tenantId, hasAi, hasCosts }: { tenantId: string; hasAi: boolean; hasCosts: boolean }) {
  const router = useRouter();
  const [draftId] = useState(() => crypto.randomUUID());
  const [text, setText] = useState("");
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [uploading, setUploading] = useState(0);
  const [pos, setPos] = useState<{ lat: number; lng: number } | null>(null);
  const [address, setAddress] = useState("");
  const [gpsNote, setGpsNote] = useState<string | null>(null);
  const [customer, setCustomer] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const camera = useRef<HTMLInputElement>(null);

  const dictation = useDictation((said) => setText((t) => (t ? `${t} ${said}` : said)));

  function locate() {
    if (!navigator.geolocation) {
      setGpsNote("This device can't share its location. Type the site address.");
      return;
    }
    setGpsNote("Finding you...");
    navigator.geolocation.getCurrentPosition(
      async (p) => {
        const here = { lat: p.coords.latitude, lng: p.coords.longitude };
        setPos(here);
        setGpsNote(`GPS ±${Math.round(p.coords.accuracy)} m`);
        try {
          const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&zoom=18&lat=${here.lat}&lon=${here.lng}`);
          const j = (await r.json()) as { address?: Record<string, string> };
          const a = j.address ?? {};
          const street = [a.house_number, a.road].filter(Boolean).join(" ");
          const place = a.suburb ?? a.town ?? a.city ?? a.village ?? "";
          setAddress((old) => old || [street, place].filter(Boolean).join(", "));
        } catch {
          /* address stays editable */
        }
      },
      () => setGpsNote("Location is off. Type the site address, or allow location for this site."),
      { enableHighAccuracy: true, timeout: 15000 },
    );
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- ask for the site location once on open
    locate();
  }, []);

  async function addPhotos(list: FileList | null) {
    if (!list) return;
    const supabase = createClient();
    for (const file of Array.from(list).slice(0, 12 - photos.length)) {
      setUploading((n) => n + 1);
      try {
        const blob = await shrink(file);
        const path = `${tenantId}/uploads/site-${draftId}/photo-${Date.now()}-${Math.round(Math.random() * 1e6)}.jpg`;
        const { error: upErr } = await supabase.storage.from("job-files").upload(path, blob, { contentType: "image/jpeg" });
        if (upErr) throw upErr;
        setPhotos((p) => [...p, { path, preview: URL.createObjectURL(blob) }]);
      } catch (e) {
        setError(`A photo didn't upload: ${e instanceof Error ? e.message : "try again"}`);
      } finally {
        setUploading((n) => n - 1);
      }
    }
  }

  async function build() {
    dictation.stop();
    setBusy(true);
    setError(null);
    const r = await buildSiteQuote({
      draftId, transcript: text, photoPaths: photos.map((p) => p.path),
      lat: pos?.lat ?? null, lng: pos?.lng ?? null, address, customer,
    });
    if (r.ok) router.push(`/site/${r.id}`);
    else {
      setError(r.message);
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {!hasCosts && (
        <p className="card" style={{ background: "var(--warn-bg)", borderColor: "#f0dba5" }}>
          Your costs library is empty. <a href="/costs" style={{ fontWeight: 600, textDecoration: "underline" }}>Add your costs</a> so quotes can be priced.
        </p>
      )}

      <div className="card" style={{ padding: "10px 14px", display: "grid", gridTemplateColumns: "auto 1fr", alignItems: "center", gap: 10 }}>
        <label htmlFor="cust" style={{ fontWeight: 600, fontSize: 13 }}>Customer</label>
        <input id="cust" type="text" value={customer} onChange={(e) => setCustomer(e.target.value)} placeholder="Who is the quote for? (optional)" style={{ minWidth: 0, padding: 8 }} />
        <label htmlFor="addr" style={{ fontWeight: 600, fontSize: 13 }}>Site</label>
        <div className="row" style={{ gap: 10, flexWrap: "nowrap" }}>
          <input id="addr" type="text" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Site address" style={{ flex: 1, minWidth: 0, padding: 8 }} />
          <button type="button" className="btn" style={{ padding: "8px 10px", fontSize: 13, flex: "none" }} onClick={locate}>{pos ? "Update GPS" : "Use GPS"}</button>
        </div>
        {gpsNote && <span className="sub" style={{ marginTop: 0, fontSize: 12, gridColumn: "2" }}>{gpsNote}</span>}
      </div>

      <div className="card" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <label htmlFor="said" style={{ fontWeight: 600 }}>
          {dictation.listening ? <span style={{ color: "var(--accent)" }}>● Listening...</span> : "Tell me about the job"}
        </label>
        <textarea
          id="said" rows={7} value={dictation.interim ? `${text} ${dictation.interim}`.trim() : text}
          onChange={(e) => setText(e.target.value)} readOnly={dictation.listening}
          placeholder={"e.g. Carpark, about 2,000 square metres, 40 mil AC10, one day. Mix from the Narangba plant. Soft spot near the entry, 60 square, dig out and put in a 100 mil base. Bobcat for half a day."}
        />
        <span className="sub" style={{ marginTop: 0, fontSize: 12 }}>
          {dictation.supported
            ? "Tap the mic and talk. Say the area, depth, mix, how long it'll take and where the mix comes from. You can edit the text."
            : "Tap the text box and use your keyboard's mic to talk, or type."}
        </span>
        {dictation.error && <span className="error" style={{ fontSize: 13 }}>{dictation.error}</span>}
      </div>

      <div className="card" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ fontWeight: 600 }}>Photos · {photos.length}{uploading ? ` (uploading ${uploading})` : ""}</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 8 }}>
          {photos.map((p) => (
            // eslint-disable-next-line @next/next/no-img-element -- local preview of an uploaded photo
            <img key={p.path} src={p.preview} alt="Site photo" style={{ width: "100%", aspectRatio: "1", objectFit: "cover", borderRadius: 10 }} />
          ))}
          {photos.length < 12 && (
            <button type="button" aria-label="Take or add a photo" onClick={() => camera.current?.click()}
              style={{ aspectRatio: "1", borderRadius: 10, border: "2px dashed #b6bcc4", background: "transparent", color: "var(--muted)", fontSize: 26, cursor: "pointer" }}>
              +
            </button>
          )}
        </div>
        <input ref={camera} type="file" accept="image/*" capture="environment" multiple hidden onChange={(e) => { addPhotos(e.target.files); e.target.value = ""; }} />
      </div>

      {error && <p className="error" role="alert">{error}</p>}

      <div style={{ position: "sticky", bottom: 0, background: "var(--ground)", padding: "10px 0 14px", display: "flex", gap: 12, alignItems: "center" }}>
        {dictation.supported && (
          <button type="button" onClick={dictation.listening ? dictation.stop : dictation.start} aria-label={dictation.listening ? "Stop listening" : "Start talking"}
            style={{
              width: 68, height: 68, borderRadius: 34, border: 0, flex: "none", cursor: "pointer",
              background: dictation.listening ? "var(--accent)" : "var(--ink)", color: "#fff",
              boxShadow: dictation.listening ? "0 0 0 8px rgba(194,65,12,0.18)" : "none",
            }}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></svg>
          </button>
        )}
        <button type="button" className="btn primary" style={{ flex: 1, padding: 16, fontSize: 16 }} disabled={busy || uploading > 0} onClick={build}>
          {busy ? (hasAi ? "Working it out..." : "Saving...") : "Build the quote"}
        </button>
      </div>
      {!hasAi && <p className="sub" style={{ marginTop: 0, fontSize: 12 }}>The AI isn&apos;t switched on yet, so you&apos;ll add the items yourself on the next screen.</p>}
    </div>
  );
}
