/**
 * Drawing sheets as pictures, so the AI sees the plans and sections themselves and not just the words
 * pulled out of them (dimensions, hatching and which area is ours only show on the page).
 *
 * A page counts as a drawing when it's bigger than A4 (A3, A1 sheets), or when the PDF has no text
 * at all (a scan). Text-heavy A4 pages (specs, schedules, conditions) stay as text.
 */
import "server-only";

type Mupdf = typeof import("mupdf");
let lib: Promise<Mupdf> | null = null;
const load = () => (lib ??= import("mupdf"));

/** Longest side of an A4 page is 842 pt: anything clearly bigger is a drawing sheet. */
const A4_LONG = 842;

export type DrawingPage = { page: number; jpg: Uint8Array };

/** Which pages to look at: drawing-sized ones, or every page of a scan. Pure, for testing. */
export function pickDrawingPages(sizes: { w: number; h: number; chars: number }[], max: number): number[] {
  const scan = sizes.every((s) => s.chars < 20);
  const out: number[] = [];
  sizes.forEach((s, i) => {
    const big = Math.max(s.w, s.h) > A4_LONG * 1.15;
    // A landscape A4 sheet with little text is usually a drawing too (A3 plots shrunk to A4).
    const landscapeSparse = s.w > s.h && s.chars < 2500;
    if (scan || big || landscapeSparse) out.push(i + 1);
  });
  return out.slice(0, max);
}

/**
 * Renders the drawing pages of a PDF as JPEGs about `px` pixels on the long side.
 * Returns [] for a text document, or when the PDF can't be opened.
 */
export async function drawingPages(bytes: Uint8Array, opts: { max?: number; px?: number } = {}): Promise<DrawingPage[]> {
  const max = opts.max ?? 12;
  const px = opts.px ?? 1600;
  try {
    const mupdf = await load();
    const doc = mupdf.Document.openDocument(bytes, "application/pdf");
    const n = Math.min(doc.countPages(), 60);
    const sizes: { w: number; h: number; chars: number }[] = [];
    for (let i = 0; i < n; i++) {
      const p = doc.loadPage(i);
      const [x0, y0, x1, y1] = p.getBounds();
      let chars = 0;
      try { chars = p.toStructuredText("preserve-whitespace").asText().replace(/\s+/g, "").length; } catch { /* no text layer */ }
      sizes.push({ w: x1 - x0, h: y1 - y0, chars });
    }
    const pages = pickDrawingPages(sizes, max);
    const out: DrawingPage[] = [];
    for (const num of pages) {
      const p = doc.loadPage(num - 1);
      const { w, h } = sizes[num - 1];
      const s = px / Math.max(w, h, 1);
      const pix = p.toPixmap(mupdf.Matrix.scale(s, s), mupdf.ColorSpace.DeviceRGB, false, true);
      out.push({ page: num, jpg: pix.asJPEG(78, false) });
    }
    console.info(`[drawings] ${n} pages, ${out.length} as pictures (sizes ${sizes.slice(0, 4).map((z) => `${Math.round(z.w)}x${Math.round(z.h)}/${z.chars}`).join(", ")})`);
    return out;
  } catch (e) {
    console.warn("[drawings] couldn't render:", e instanceof Error ? e.message : e);
    return [];
  }
}
