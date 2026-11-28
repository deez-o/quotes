"use client";

import { useState } from "react";
import { DocumentViewer } from "./markups";

/** The RFQ's documents: click one to read it full screen, zoomable, every page. */
export function Documents({ files }: { files: { name: string; url: string | null; about: string | null }[] }) {
  const [open, setOpen] = useState<{ name: string; url: string } | null>(null);
  return (
    <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
      {files.map((f) => (
        <div key={f.name} className="row" style={{ gap: 10, alignItems: "flex-start" }}>
          <div className="grow">
            {f.url && /\.(pdf|png|jpe?g|webp)$/i.test(f.name)
              ? <button type="button" className="linkish" onClick={() => setOpen({ name: f.name, url: f.url! })} style={{ fontWeight: 600 }}>{f.name}</button>
              : f.url ? <a href={f.url} target="_blank" rel="noreferrer" style={{ fontWeight: 600 }}>{f.name}</a> : <strong>{f.name}</strong>}
            {f.about && <div className="sub">{f.about}</div>}
          </div>
          {f.url && <a href={f.url} target="_blank" rel="noreferrer" className="sub" style={{ fontSize: 12, whiteSpace: "nowrap" }}>Download</a>}
        </div>
      ))}
      {open && <DocumentViewer name={open.name} url={open.url} onClose={() => setOpen(null)} />}
    </div>
  );
}
