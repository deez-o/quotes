/* eslint-disable @typescript-eslint/no-explicit-any -- the Google Maps script has no types installed here */
/**
 * A drawing laid on the Google satellite map at true size. Width is in metres on the ground, so it
 * scales with zoom; it can be dragged into place and turned. "Locked" lets taps go through it to
 * the map, for tracing areas and measuring over the top.
 */
import type { PlanOverlay } from "@/lib/rfq/overview";

export type OverlayHandle = { update: (s: PlanOverlay, locked: boolean) => void; remove: () => void };

export function createPlanOverlay(g: any, map: any, image: { url: string; aspect: number }, start: PlanOverlay, locked: boolean, onMove: (lat: number, lng: number) => void): OverlayHandle {
  let state = start;
  let isLocked = locked;
  const div = document.createElement("div");
  div.style.position = "absolute";
  div.style.transformOrigin = "50% 50%";
  div.style.touchAction = "none";
  const img = document.createElement("img");
  img.src = image.url;
  img.alt = "Plan";
  img.draggable = false;
  img.style.width = "100%";
  img.style.height = "100%";
  img.style.display = "block";
  img.style.userSelect = "none";
  div.appendChild(img);

  const ov = new g.maps.OverlayView();
  let drag: { x: number; y: number; cx: number; cy: number } | null = null;

  ov.onAdd = () => {
    ov.getPanes().overlayMouseTarget.appendChild(div);
    div.addEventListener("pointerdown", (e: PointerEvent) => {
      if (isLocked) return;
      const p = ov.getProjection().fromLatLngToDivPixel(new g.maps.LatLng(state.lat, state.lng));
      drag = { x: e.clientX, y: e.clientY, cx: p.x, cy: p.y };
      div.setPointerCapture(e.pointerId);
      map.setOptions({ draggable: false });
      e.stopPropagation();
    });
    div.addEventListener("pointermove", (e: PointerEvent) => {
      if (!drag) return;
      const ll = ov.getProjection().fromDivPixelToLatLng(new g.maps.Point(drag.cx + e.clientX - drag.x, drag.cy + e.clientY - drag.y));
      state = { ...state, lat: ll.lat(), lng: ll.lng() };
      ov.draw();
    });
    const end = () => {
      if (!drag) return;
      drag = null;
      map.setOptions({ draggable: true });
      onMove(state.lat, state.lng);
    };
    div.addEventListener("pointerup", end);
    div.addEventListener("pointercancel", end);
  };

  ov.draw = () => {
    const proj = ov.getProjection();
    if (!proj) return;
    const c = proj.fromLatLngToDivPixel(new g.maps.LatLng(state.lat, state.lng));
    // Pixels per metre here: measure 100 m east of the centre.
    const east = proj.fromLatLngToDivPixel(new g.maps.LatLng(state.lat, state.lng + 100 / (111320 * Math.cos((state.lat * Math.PI) / 180))));
    const pxPerM = Math.abs(east.x - c.x) / 100;
    const w = state.widthM * pxPerM;
    const h = w * image.aspect;
    div.style.left = `${c.x - w / 2}px`;
    div.style.top = `${c.y - h / 2}px`;
    div.style.width = `${w}px`;
    div.style.height = `${h}px`;
    div.style.transform = `rotate(${state.rotation}deg)`;
    div.style.opacity = String(state.opacity);
    div.style.pointerEvents = isLocked ? "none" : "auto";
    div.style.cursor = isLocked ? "default" : "move";
    div.style.outline = isLocked ? "none" : "2px dashed #FF6A13";
  };

  ov.onRemove = () => div.remove();
  ov.setMap(map);

  return {
    update: (s, l) => { state = s; isLocked = l; ov.draw(); },
    remove: () => ov.setMap(null),
  };
}

/** Render one page of a PDF (or an image file) to a picture, and read its scale from the title block. */
export async function renderPlan(url: string, name: string, pageNo: number): Promise<{ url: string; aspect: number; pages: number; text: string; widthPt: number; heightPt: number }> {
  if (!/\.pdf$/i.test(name)) {
    const im = new Image();
    im.crossOrigin = "anonymous";
    im.src = url;
    await im.decode();
    return { url, aspect: im.naturalHeight / im.naturalWidth, pages: 1, text: "", widthPt: im.naturalWidth, heightPt: im.naturalHeight };
  }
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
  const doc = await pdfjs.getDocument({ url }).promise;
  const page = await doc.getPage(Math.min(Math.max(1, pageNo), doc.numPages));
  const base = page.getViewport({ scale: 1 });
  const scale = Math.min(4, 2400 / base.width);
  const vp = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(vp.width);
  canvas.height = Math.round(vp.height);
  await page.render({ canvas, canvasContext: canvas.getContext("2d")!, viewport: vp }).promise;
  const content = await page.getTextContent();
  const text = content.items.map((i) => ("str" in i ? i.str : "")).join(" ");
  return { url: canvas.toDataURL("image/jpeg", 0.85), aspect: vp.height / vp.width, pages: doc.numPages, text, widthPt: base.width, heightPt: base.height };
}
