"use client";

import { useEffect, useRef, useState } from "react";
import type { OverviewMarkup } from "@/lib/rfq/overview";
import { Lightbox } from "./lightbox";

type Box = { x: number; y: number; w: number; h: number };
type Note = { note: string; box: Box | null; area: boolean };
type Callout = { note: string; target: Box; area: boolean; label: Box; text: string };

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
const overlaps = (a: Box, b: Box, pad = 6) => a.x < b.x + b.w + pad && b.x < a.x + a.w + pad && a.y < b.y + b.h + pad && b.y < a.y + a.h + pad;

type Rendered = { src: string; w: number; h: number; find: (anchor: string) => Box | null };

/** Each PDF is downloaded and opened once, however many of its pages are shown. */
const docs = new Map<string, Promise<import("pdfjs-dist").PDFDocumentProxy>>();
function openDoc(url: string) {
  let d = docs.get(url);
  if (!d) {
    d = import("pdfjs-dist").then((pdfjs) => {
      pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
      return pdfjs.getDocument({ url }).promise;
    });
    docs.set(url, d);
  }
  return d;
}
/** One page drawn at a time, so a long set of drawings doesn't freeze the page. */
let queue: Promise<unknown> = Promise.resolve();
function inTurn<T>(job: () => Promise<T>): Promise<T> {
  const run = queue.then(job, job);
  queue = run.catch(() => undefined);
  return run;
}

/** One PDF page as a picture, with a finder for words printed on it. */
function renderPage(url: string, page: number, px = 1800): Promise<Rendered & { pages: number }> {
  return inTurn(() => drawPage(url, page, px));
}
async function drawPage(url: string, page: number, px: number): Promise<Rendered & { pages: number }> {
  const doc = await openDoc(url);
  const p = await doc.getPage(Math.min(Math.max(1, page), doc.numPages));
  const base = p.getViewport({ scale: 1 });
  const vp = p.getViewport({ scale: Math.min(4, px / Math.max(base.width, base.height)) });
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
  const W = canvas.width, H = canvas.height;
  const find = (anchor: string): Box | null => {
    const a = norm(anchor);
    if (a.length < 2) return null;
    let best: Box | null = null;
    for (let i = 0; i < items.length; i++) {
      let joined = "";
      for (let j = i; j < Math.min(items.length, i + 4); j++) {
        joined = norm(`${joined} ${items[j].str}`);
        if (joined.includes(a)) {
          const bs = items.slice(i, j + 1).map(boxOf);
          const x = Math.min(...bs.map((b) => b.x)), y = Math.min(...bs.map((b) => b.y));
          const b = { x, y, w: Math.max(...bs.map((b) => b.x + b.w)) - x, h: Math.max(...bs.map((b) => b.y + b.h)) - y };
          // Words, not a block: a match spread over a big part of the sheet (or the title block) is wrong.
          const inTitleBlock = b.y > H * 0.8 && b.x > W * 0.3;
          if (b.w < W * 0.3 && b.h < H * 0.08 && !inTitleBlock && (!best || b.w * b.h < best.w * best.h)) best = b;
          break;
        }
        if (j > i && !a.startsWith(joined.slice(0, Math.min(joined.length, a.length)))) break;
      }
    }
    return best;
  };
  const src = canvas.toDataURL("image/jpeg", 0.85);
  canvas.width = 0; canvas.height = 0; // free the canvas memory
  return { src, w: W, h: H, find, pages: doc.numPages };
}

/** A ready-made page picture, with no words to pin to (notes use their boxes). */
function loadImage(src: string): Promise<Rendered> {
  return new Promise((resolve, reject) => {
    const im = new Image();
    im.onload = () => resolve({ src, w: im.naturalWidth, h: im.naturalHeight, find: () => null });
    im.onerror = () => reject(new Error("image"));
    im.src = src;
  });
}

/** Puts each note's label near what it points at, without labels covering each other. */
function layout(notes: Note[], W: number, H: number, fs: number): Callout[] {
  const placed: Box[] = [];
  const out: Callout[] = [];
  for (const n of notes) {
    if (!n.box) continue;
    const text = n.note.length > 64 ? `${n.note.slice(0, 62)}...` : n.note;
    const lw = Math.min(W * 0.5, text.length * fs * 0.56 + fs * 1.4);
    const lh = fs * 2;
    const t = n.box;
    const gap = fs * 1.6;
    const tries: Box[] = [
      { x: t.x + t.w + gap, y: t.y - lh - gap, w: lw, h: lh },
      { x: t.x + t.w + gap, y: t.y + t.h + gap, w: lw, h: lh },
      { x: t.x - lw - gap, y: t.y - lh - gap, w: lw, h: lh },
      { x: t.x - lw - gap, y: t.y + t.h + gap, w: lw, h: lh },
      { x: t.x, y: t.y - lh - gap * 2, w: lw, h: lh },
      { x: t.x, y: t.y + t.h + gap * 2, w: lw, h: lh },
    ].map((b) => ({ ...b, x: Math.min(Math.max(8, b.x), W - b.w - 8), y: Math.min(Math.max(8, b.y), H - b.h - 8) }));
    let label = tries.find((b) => !placed.some((p) => overlaps(p, b)) && !overlaps(b, t, 0));
    if (!label) {
      // Step down from the first spot until it's clear.
      label = { ...tries[0] };
      for (let k = 0; k < 40 && placed.some((p) => overlaps(p, label!)); k++) label.y = Math.min(H - lh - 8, label.y + lh + 6);
    }
    placed.push(label);
    out.push({ note: n.note, target: t, area: n.area, label, text });
  }
  return out;
}

function MarkupSvg({ img, callouts, name, page }: { img: Rendered; callouts: Callout[]; name: string; page: number }) {
  const fs = Math.max(14, img.w / 95);
  return (
    <svg viewBox={`0 0 ${img.w} ${img.h}`} style={{ width: "100%", height: "auto", display: "block", background: "#fff" }} role="img" aria-label={`${name}, page ${page}, with notes`}>
      <image href={img.src} width={img.w} height={img.h} />
      {callouts.map((c, i) => {
        const t = c.target, l = c.label;
        const tx = Math.min(Math.max(l.x + l.w / 2, t.x), t.x + t.w), ty = Math.min(Math.max(l.y + l.h / 2, t.y), t.y + t.h);
        const lx = Math.min(Math.max(tx, l.x), l.x + l.w), ly = l.y + l.h / 2 < ty ? l.y + l.h : l.y;
        return (
          <g key={i}>
            {c.area
              ? <rect x={t.x} y={t.y} width={t.w} height={t.h} fill="#FFD60040" stroke="#E0A800" strokeWidth={Math.max(3, fs / 5)} strokeDasharray={`${fs} ${fs / 2}`} rx={6} />
              : <rect x={t.x - 4} y={t.y - 4} width={t.w + 8} height={t.h + 8} fill="#FFD60066" stroke="#E0A800" strokeWidth={3} rx={4} />}
            <line x1={tx} y1={ty} x2={lx} y2={ly} stroke="#C8102E" strokeWidth={Math.max(2, fs / 7)} />
            <circle cx={tx} cy={ty} r={fs / 4} fill="#C8102E" />
            <rect x={l.x} y={l.y} width={l.w} height={l.h} fill="#FFF" stroke="#C8102E" strokeWidth={Math.max(2, fs / 7)} rx={6} />
            <text x={l.x + fs * 0.7} y={l.y + l.h / 2 + fs * 0.35} fontSize={fs} fontWeight={700} fill="#C8102E" fontFamily="Arial, sans-serif">{c.text}</text>
          </g>
        );
      })}
    </svg>
  );
}

/**
 * One drawing page with our notes pinned on it: our areas outlined, the words they refer to
 * highlighted, and a red label beside each. Click it to see it full screen and zoom in.
 */
function MarkedPage({ url, image, name, page, notes }: { url: string; image: string | null; name: string; page: number; notes: OverviewMarkup[] }) {
  const [img, setImg] = useState<Rendered | null>(null);
  const [callouts, setCallouts] = useState<Callout[]>([]);
  const [missed, setMissed] = useState<string[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [big, setBig] = useState(false);
  const done = useRef(false);
  const box = useRef<HTMLElement>(null);
  const [seen, setSeen] = useState(false);

  // Only drawn once it's nearly on screen.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { setSeen(true); io.disconnect(); } }, { rootMargin: "600px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!seen || done.current) return;
    done.current = true;
    (async () => {
      try {
        // The page picture made when the RFQ was read: no PDF to open. Notes go on by their boxes.
        const r: Rendered = image ? await loadImage(image) : await renderPage(url, page);
        const ns: Note[] = notes.map((n) => {
          const words = n.anchor ? r.find(n.anchor) : null;
          const area = n.box ? { x: n.box.x * r.w, y: n.box.y * r.h, w: n.box.w * r.w, h: n.box.h * r.h } : null;
          return { note: n.note, box: area ?? words, area: Boolean(area) };
        });
        setCallouts(layout(ns, r.w, r.h, Math.max(14, r.w / 95)));
        setMissed(ns.filter((n) => !n.box).map((n) => n.note));
        setImg(r);
      } catch {
        setErr("Couldn't open this drawing here.");
      }
    })();
  }, [seen, url, image, page, notes]);

  if (err) return <p className="sub">{err}</p>;
  if (!img) return <figure ref={box} style={{ margin: 0, minHeight: 240, display: "grid", placeItems: "center", border: "1px dashed var(--line)", borderRadius: 8 }}><span className="sub">{name}, page {page}: {seen ? "drawing..." : "waiting"}</span></figure>;
  return (
    <figure style={{ margin: 0 }}>
      <button type="button" onClick={() => setBig(true)} className="drawing-thumb" aria-label={`Open ${name} page ${page} full screen`}>
        <MarkupSvg img={img} callouts={callouts} name={name} page={page} />
      </button>
      <figcaption className="sub" style={{ fontSize: 12 }}>
        {name}, page {page} · click to enlarge
        {missed.length > 0 && <> · Also: {missed.join("; ")}</>}
      </figcaption>
      {big && (
        <Lightbox title={`${name}, page ${page}`} onClose={() => setBig(false)}>
          <MarkupSvg img={img} callouts={callouts} name={name} page={page} />
        </Lightbox>
      )}
    </figure>
  );
}

/** The drawings with our notes on them, one marked-up page after another. */
export function DrawingMarkups({ markups, files }: { markups: OverviewMarkup[]; files: { name: string; url: string | null; pages?: Record<number, string> }[] }) {
  const urlOf = new Map(files.map((f) => [f.name.toLowerCase(), f.url]));
  const picOf = (file: string, page: number) => files.find((f) => f.name.toLowerCase() === file.toLowerCase())?.pages?.[page] ?? null;
  const pages = new Map<string, OverviewMarkup[]>();
  for (const m of markups) {
    const k = `${m.file.toLowerCase()}|${m.page}`;
    if (urlOf.get(m.file.toLowerCase()) && /\.pdf$/i.test(m.file)) pages.set(k, [...(pages.get(k) ?? []), m]);
  }
  if (!pages.size) return null;
  const sorted = [...pages.entries()].sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }));
  return (
    <div style={{ display: "grid", gap: 16 }}>
      {sorted.map(([k, notes]) => (
        <MarkedPage key={k} url={urlOf.get(notes[0].file.toLowerCase())!} image={picOf(notes[0].file, notes[0].page)} name={notes[0].file} page={notes[0].page} notes={notes} />
      ))}
    </div>
  );
}

/** A document opened full screen: the browser's own PDF viewer (fast, zoomable, every page), or the picture. */
export function DocumentViewer({ name, url, onClose }: { name: string; url: string; onClose: () => void }) {
  const pdf = /\.pdf$/i.test(name);
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [onClose]);
  if (!pdf) {
    return (
      <Lightbox title={name} onClose={onClose}>
        {/* eslint-disable-next-line @next/next/no-img-element -- signed storage URL */}
        <img src={url} alt={name} style={{ width: "100%", background: "#fff" }} />
      </Lightbox>
    );
  }
  return (
    <div role="dialog" aria-modal="true" aria-label={name} className="lightbox">
      <div className="lightbox-bar">
        <strong style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</strong>
        <div className="row" style={{ gap: 6 }}>
          <a className="btn" href={url} target="_blank" rel="noreferrer">Open in a new tab</a>
          <button type="button" className="btn dark" onClick={onClose}>Close</button>
        </div>
      </div>
      <iframe src={`${url}#view=FitH`} title={name} style={{ flex: 1, border: 0, background: "#fff", width: "100%" }} />
    </div>
  );
}
