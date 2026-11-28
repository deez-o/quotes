"use client";

import { useEffect, useRef, useState } from "react";
import type { OverviewMarkup } from "@/lib/rfq/overview";

type Box = { x: number; y: number; w: number; h: number };
type Placed = { note: string; anchor: string; box: Box | null };

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

/**
 * One drawing page with our notes pinned on it: the words each note points at are highlighted
 * and a red callout sits beside them. Pinned to the drawing's own text, so it lands in the right place.
 */
function MarkedPage({ url, name, page, notes }: { url: string; name: string; page: number; notes: OverviewMarkup[] }) {
  const [img, setImg] = useState<{ src: string; w: number; h: number } | null>(null);
  const [placed, setPlaced] = useState<Placed[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const done = useRef(false);

  useEffect(() => {
    if (done.current) return;
    done.current = true;
    (async () => {
      try {
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
        const doc = await pdfjs.getDocument({ url }).promise;
        const p = await doc.getPage(Math.min(Math.max(1, page), doc.numPages));
        const base = p.getViewport({ scale: 1 });
        const vp = p.getViewport({ scale: Math.min(3, 2200 / base.width) });
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(vp.width);
        canvas.height = Math.round(vp.height);
        await p.render({ canvas, canvasContext: canvas.getContext("2d")!, viewport: vp }).promise;
        const content = await p.getTextContent();
        const items = content.items.filter((i): i is (typeof i & { str: string; transform: number[]; width: number; height: number }) => "str" in i && Boolean((i as { str: string }).str.trim()));
        const boxOf = (it: (typeof items)[number]): Box => {
          const [x1, y1] = vp.convertToViewportPoint(it.transform[4], it.transform[5]);
          const [x2, y2] = vp.convertToViewportPoint(it.transform[4] + it.width, it.transform[5] + (it.height || Math.hypot(it.transform[2], it.transform[3])));
          return { x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1) || 20, h: Math.abs(y2 - y1) || 10 };
        };
        const find = (anchor: string): Box | null => {
          const a = norm(anchor);
          if (!a) return null;
          // One text item, or a run of up to 5 neighbours that together read as the anchor.
          for (let i = 0; i < items.length; i++) {
            let joined = "";
            for (let j = i; j < Math.min(items.length, i + 5); j++) {
              joined = norm(`${joined} ${items[j].str}`);
              if (joined.includes(a)) {
                const bs = items.slice(i, j + 1).map(boxOf);
                const x = Math.min(...bs.map((b) => b.x)), y = Math.min(...bs.map((b) => b.y));
                return { x, y, w: Math.max(...bs.map((b) => b.x + b.w)) - x, h: Math.max(...bs.map((b) => b.y + b.h)) - y };
              }
              if (!a.startsWith(joined.slice(0, Math.min(joined.length, a.length))) && j > i) break;
            }
          }
          return null;
        };
        setPlaced(notes.map((n) => ({ note: n.note, anchor: n.anchor, box: find(n.anchor) })));
        setImg({ src: canvas.toDataURL("image/jpeg", 0.85), w: canvas.width, h: canvas.height });
      } catch {
        setErr("Couldn't open this drawing here.");
      }
    })();
  }, [url, page, notes]);

  if (err) return <p className="sub">{err}</p>;
  if (!img) return <p className="sub">Drawing {name} page {page}: loading...</p>;
  const fs = Math.max(14, img.w / 90);
  return (
    <figure style={{ margin: 0 }}>
      <svg viewBox={`0 0 ${img.w} ${img.h}`} style={{ width: "100%", height: "auto", border: "1px solid var(--line)", borderRadius: 8, background: "#fff" }} role="img" aria-label={`${name}, page ${page}, with notes`}>
        <image href={img.src} width={img.w} height={img.h} />
        {placed.map((p, i) => {
          if (!p.box) return null;
          const b = p.box;
          // Callout above-right of the words, kept on the page.
          const tw = Math.min(img.w * 0.45, p.note.length * fs * 0.55 + 24);
          const cx = Math.min(img.w - tw - 8, b.x + b.w + 30);
          const cy = Math.max(8, b.y - fs * 2.6 - 10 - (i % 3) * fs * 0.6);
          return (
            <g key={i}>
              <rect x={b.x - 4} y={b.y - 4} width={b.w + 8} height={b.h + 8} fill="#FFD60055" stroke="#E0A800" strokeWidth={3} rx={4} />
              <line x1={b.x + b.w + 4} y1={b.y + b.h / 2} x2={cx} y2={cy + fs * 1.3} stroke="#C8102E" strokeWidth={3} />
              <rect x={cx} y={cy} width={tw} height={fs * 2.2} fill="#FFF4F4" stroke="#C8102E" strokeWidth={3} rx={6} />
              <text x={cx + 12} y={cy + fs * 1.45} fontSize={fs} fontWeight={700} fill="#C8102E" fontFamily="Arial, sans-serif">{p.note.length > 70 ? `${p.note.slice(0, 68)}...` : p.note}</text>
            </g>
          );
        })}
      </svg>
      <figcaption className="sub" style={{ fontSize: 12 }}>
        {name}, page {page}
        {placed.some((p) => !p.box) && <> · Couldn&apos;t place on the drawing: {placed.filter((p) => !p.box).map((p) => p.note).join("; ")}</>}
      </figcaption>
    </figure>
  );
}

/** The drawings with our notes on them, one marked-up page after another. */
export function DrawingMarkups({ markups, files }: { markups: OverviewMarkup[]; files: { name: string; url: string | null }[] }) {
  const urlOf = new Map(files.map((f) => [f.name.toLowerCase(), f.url]));
  const pages = new Map<string, OverviewMarkup[]>();
  for (const m of markups) {
    const k = `${m.file.toLowerCase()}|${m.page}`;
    if (urlOf.get(m.file.toLowerCase()) && /\.pdf$/i.test(m.file)) pages.set(k, [...(pages.get(k) ?? []), m]);
  }
  if (!pages.size) return null;
  return (
    <div style={{ display: "grid", gap: 16 }}>
      {[...pages.entries()].map(([k, notes]) => (
        <MarkedPage key={k} url={urlOf.get(notes[0].file.toLowerCase())!} name={notes[0].file} page={notes[0].page} notes={notes} />
      ))}
    </div>
  );
}
