"use client";
/* eslint-disable @next/next/no-img-element -- logos come from short-lived signed URLs and local previews */

import { useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { BRAND_PRESETS, DEFAULT_BRAND, isHex, textOn } from "@/lib/branding";
import { saveBranding } from "./branding-actions";
import { AutoSave } from "../auto-save";

export type Branding = {
  logo_path: string | null; logo_url: string | null; brand_color: string | null;
  business_name: string | null; business_abn: string | null; business_phone: string | null; state?: string | null;
  business_email: string | null; business_address: string | null; business_website: string | null;
};

const field: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 4, fontSize: 13 };

/** Logo, colour and business details for the quotes this company sends. */
export function BrandingForm({ tenantId, initial, fallbackName, canEdit }: { tenantId: string; initial: Branding; fallbackName: string; canEdit: boolean }) {
  const [logoPath, setLogoPath] = useState(initial.logo_path);
  const [logoUrl, setLogoUrl] = useState(initial.logo_url);
  const [color, setColor] = useState(initial.brand_color ?? DEFAULT_BRAND);
  const [name, setName] = useState(initial.business_name ?? fallbackName);
  const [busy, setBusy] = useState<null | "logo" | "save">(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const file = useRef<HTMLInputElement>(null);

  async function upload(f: File | undefined) {
    if (!f) return;
    if (!/^image\/(png|jpeg|webp|svg\+xml)$/.test(f.type)) return setMsg({ ok: false, text: "Use a PNG, JPG, WebP or SVG logo." });
    if (f.size > 2 * 1024 * 1024) return setMsg({ ok: false, text: "Keep the logo under 2 MB." });
    setBusy("logo");
    setMsg(null);
    const ext = f.type === "image/svg+xml" ? "svg" : f.type.split("/")[1].replace("jpeg", "jpg");
    const path = `${tenantId}/uploads/branding/logo-${crypto.randomUUID()}.${ext}`;
    const { error } = await createClient().storage.from("job-files").upload(path, f, { contentType: f.type });
    setBusy(null);
    if (file.current) file.current.value = "";
    if (error) return setMsg({ ok: false, text: error.message });
    setLogoPath(path);
    setLogoUrl(URL.createObjectURL(f));
    setMsg({ ok: true, text: "Logo added." });
  }

  async function save(fd: FormData) {
    setBusy("save");
    const r = await saveBranding(fd);
    setBusy(null);
    setMsg({ ok: r.ok, text: r.message });
  }

  const ink = textOn(color);
  return (
    <form id="branding" action={save} className="card" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div>
        <h2 style={{ margin: 0 }}>Your branding</h2>
        <p className="sub" style={{ marginTop: 2 }}>Your logo, colour and details on the quotes you print, save as PDF or send.</p>
      </div>
      <input type="hidden" name="logo_path" value={logoPath ?? ""} />
      <input type="hidden" name="brand_color" value={color} />
      {canEdit && <AutoSave watch={[logoPath, color]} />}

      <div style={{ display: "flex", flexWrap: "wrap", gap: 24, alignItems: "flex-start" }}>
        <fieldset disabled={!canEdit} style={{ border: 0, padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 14, minWidth: 0, flex: "1 1 340px" }}>
          <div style={field}>
            <span>Logo</span>
            <div className="row" style={{ gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <div style={{ flex: "none", width: 160, height: 64, border: "1px dashed #b6bcc4", borderRadius: 8, display: "grid", placeItems: "center", background: "#fff", overflow: "hidden" }}>
                {logoUrl ? <img src={logoUrl} alt="Your logo" style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} /> : <span className="sub" style={{ marginTop: 0, fontSize: 12 }}>No logo yet</span>}
              </div>
              <input ref={file} type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" hidden onChange={(e) => void upload(e.target.files?.[0])} />
              <button type="button" className="btn" onClick={() => file.current?.click()} disabled={busy !== null}>{busy === "logo" ? "Uploading..." : logoPath ? "Change logo" : "Upload logo"}</button>
              {logoPath && <button type="button" className="btn" onClick={() => { setLogoPath(null); setLogoUrl(null); }}>Remove</button>}
            </div>
            <span className="sub" style={{ marginTop: 0, fontSize: 12 }}>PNG or SVG with a clear background works best.</span>
          </div>

          <div style={field}>
            <span>Colour</span>
            <div className="row" style={{ gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              {BRAND_PRESETS.map((c) => (
                <button key={c} type="button" aria-label={`Use ${c}`} aria-pressed={color.toUpperCase() === c} onClick={() => setColor(c)}
                  style={{ flex: "none", width: 32, height: 32, borderRadius: 8, background: c, cursor: "pointer", border: color.toUpperCase() === c ? "3px solid var(--brand)" : "1px solid #d1d5db", outlineOffset: 2 }} />
              ))}
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 400 }}>
                <input type="color" value={isHex(color) ? color : DEFAULT_BRAND} onChange={(e) => setColor(e.target.value.toUpperCase())} aria-label="Pick any colour" style={{ width: 40, height: 32, padding: 0, border: 0, background: "none" }} />
                {color}
              </label>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(200px, 100%), 1fr))", gap: 10 }}>
            <label style={field}>Business name<input type="text" name="business_name" value={name} onChange={(e) => setName(e.target.value)} /></label>
            <label style={field}>ABN<input type="text" name="business_abn" defaultValue={initial.business_abn ?? ""} /></label>
            <label style={field}>Phone<input type="tel" name="business_phone" defaultValue={initial.business_phone ?? ""} /></label>
            <label style={field}>Email<input type="email" name="business_email" defaultValue={initial.business_email ?? ""} /></label>
            <label style={field}>Website<input type="text" name="business_website" defaultValue={initial.business_website ?? ""} /></label>
            <label style={field}>Address (your yard or depot)<input type="text" name="business_address" title="Crew travel time to each job is worked out from here" defaultValue={initial.business_address ?? ""} /></label>
            <label style={field}>State you work in
              <select name="state" defaultValue={initial.state ?? "QLD"} style={{ font: "inherit", padding: 10, borderRadius: 8, border: "1px solid #b6bcc4", background: "#fff" }}>
                {["QLD", "NSW", "VIC", "SA", "WA", "TAS", "NT", "ACT"].map((x) => <option key={x} value={x}>{x}</option>)}
              </select>
            </label>
          </div>
        </fieldset>

        <div aria-label="Preview of your quote header" style={{ flex: "1 1 260px", maxWidth: 420, minWidth: 0, border: "1px solid var(--line)", borderRadius: 10, overflow: "hidden", background: "#fff", fontSize: 12 }}>
          <div style={{ height: 6, background: color }} />
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: 14 }}>
            <div>
              {logoUrl ? <img src={logoUrl} alt="" style={{ maxHeight: 36, maxWidth: 140, objectFit: "contain", display: "block" }} /> : <div style={{ fontWeight: 700, fontSize: 15 }}>{name || fallbackName}</div>}
              <div style={{ color: "#5b6168", marginTop: 4 }}>{name || fallbackName}</div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontWeight: 700, fontSize: 16 }}>QUOTE</div>
              <div style={{ color: "#5b6168" }}>Q-0001</div>
            </div>
          </div>
          <div style={{ background: color, color: ink, padding: "6px 14px", fontWeight: 600, display: "flex", justifyContent: "space-between" }}><span>Description</span><span>Amount</span></div>
          <div style={{ padding: "8px 14px", display: "flex", justifyContent: "space-between" }}><span>Supply and lay AC10</span><span>$46,440</span></div>
        </div>
      </div>

      {canEdit && (
        <div className="row" style={{ gap: 12 }}>
          <span className="sub" style={{ marginTop: 0 }}>{busy === "save" ? "Saving..." : "Changes save on their own."}</span>
          {msg && <span role="status" style={{ fontSize: 14, color: msg.ok ? "var(--good)" : "var(--bad, #b42318)" }}>{msg.text}</span>}
        </div>
      )}
    </form>
  );
}
