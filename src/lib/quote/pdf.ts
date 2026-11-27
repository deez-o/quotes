/**
 * The customer's quote as a PDF, made on the server so it can be emailed.
 * Same content as the print page: business details, the lines, totals and terms.
 * Kept free of Next.js and Supabase so it can be tested.
 */
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage, type RGB } from "pdf-lib";

export type QuotePdfData = {
  brand: string;
  business: { name: string; abn: string | null; address: string | null; contact: string | null };
  logo: { bytes: Uint8Array; type: "png" | "jpg" } | null;
  quote: { number: string | null; date: string; title: string; customer: string | null; customerEmail: string | null; site: string | null };
  lines: { description: string; quantity: number; unit: string; rate: number; total: number }[];
  totals: { exGst: number; gst: number; incGst: number; gstPercent: number };
  terms: string;
};

const EXTRA = "€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ";
/** Only characters the standard PDF fonts can draw. */
export function pdfSafe(s: string): string {
  return Array.from(s.replace(/\t/g, "  ").replace(/\r/g, "")).map((ch) => {
    const c = ch.codePointAt(0)!;
    if (ch === "\n" || (c >= 0x20 && c <= 0x7e) || (c >= 0xa0 && c <= 0xff) || EXTRA.includes(ch)) return ch;
    return "?";
  }).join("");
}

const hex = (h: string): RGB => rgb(parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255);
const lum = (h: string) => {
  const c = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const money = (n: number) => `$${(Math.round(n * 100) / 100).toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Break text into lines that fit the width. */
export function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const out: string[] = [];
  for (const para of pdfSafe(text).split("\n")) {
    if (!para.trim()) { out.push(""); continue; }
    let line = "";
    for (const word of para.split(/ +/)) {
      const next = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(next, size) <= width) { line = next; continue; }
      if (line) out.push(line);
      // A single word wider than the column: cut it.
      let w = word;
      while (font.widthOfTextAtSize(w, size) > width && w.length > 1) {
        let i = w.length - 1;
        while (i > 1 && font.widthOfTextAtSize(w.slice(0, i), size) > width) i--;
        out.push(w.slice(0, i));
        w = w.slice(i);
      }
      line = w;
    }
    out.push(line);
  }
  return out;
}

export async function quotePdf(d: QuotePdfData): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(pdfSafe(`Quote ${d.quote.number ?? ""} ${d.quote.title}`.trim()));
  doc.setAuthor(pdfSafe(d.business.name));
  doc.setCreator("quoteout");
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const W = 595.28, H = 841.89, M = 46;
  const ink = hex("#1c1f23"), grey = hex("#5b6168"), rule = hex("#e1e4e8");
  const brand = /^#[0-9a-f]{6}$/i.test(d.brand) ? d.brand : "#16181B";
  const brandC = hex(brand);
  const onBrand = lum(brand) > 0.45 ? hex("#16181B") : rgb(1, 1, 1);
  const accent = lum(brand) > 0.18 ? hex("#16181B") : brandC;

  let page: PDFPage = doc.addPage([W, H]);
  let y = H - M;
  const text = (s: string, x: number, yy: number, size = 10, f = font, color = ink) => page.drawText(pdfSafe(s), { x, y: yy, size, font: f, color });
  const right = (s: string, xr: number, yy: number, size = 10, f = font, color = ink) => text(s, xr - f.widthOfTextAtSize(pdfSafe(s), size), yy, size, f, color);
  const newPage = () => {
    page = doc.addPage([W, H]);
    y = H - M;
    text(`${d.business.name} · Quote ${d.quote.number ?? ""}`, M, y, 9, font, grey);
    y -= 22;
  };
  const need = (h: number) => { if (y - h < M + 20) newPage(); };

  // Brand bar and header.
  page.drawRectangle({ x: M, y: y - 6, width: W - 2 * M, height: 6, color: brandC });
  y -= 26;
  const top = y;
  let left = top;
  if (d.logo) {
    try {
      const img = d.logo.type === "png" ? await doc.embedPng(d.logo.bytes) : await doc.embedJpg(d.logo.bytes);
      const s = Math.min(200 / img.width, 54 / img.height, 1);
      page.drawImage(img, { x: M, y: left - img.height * s, width: img.width * s, height: img.height * s });
      left -= img.height * s + 8;
      text(d.business.name, M, left - 10, 11, bold);
      left -= 16;
    } catch {
      text(d.business.name, M, left - 18, 18, bold);
      left -= 26;
    }
  } else {
    text(d.business.name, M, left - 18, 18, bold);
    left -= 26;
  }
  for (const l of [d.business.abn ? `ABN ${d.business.abn}` : "", d.business.address ?? "", d.business.contact ?? ""].filter(Boolean)) {
    for (const w of wrap(l, font, 9, 300)) { text(w, M, left - 9, 9, font, grey); left -= 12; }
  }
  right("QUOTE", W - M, top - 20, 20, bold, accent);
  if (d.quote.number) right(d.quote.number, W - M, top - 36, 10);
  right(d.quote.date, W - M, top - 50, 10, font, grey);
  y = Math.min(left, top - 56) - 12;
  page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 1, color: rule });
  y -= 22;

  // For and site.
  const colW = (W - 2 * M - 24) / 2;
  text("FOR", M, y, 8, bold, grey);
  text("SITE", M + colW + 24, y, 8, bold, grey);
  const forLines = [...wrap(d.quote.customer || "-", font, 10, colW), ...(d.quote.customerEmail ? wrap(d.quote.customerEmail, font, 10, colW) : [])];
  const siteLines = wrap(d.quote.site || "-", font, 10, colW);
  forLines.forEach((l, i) => text(l, M, y - 14 - i * 13, 10));
  siteLines.forEach((l, i) => text(l, M + colW + 24, y - 14 - i * 13, 10));
  y -= 14 + Math.max(forLines.length, siteLines.length) * 13 + 14;

  for (const l of wrap(d.quote.title, bold, 14, W - 2 * M)) { need(20); text(l, M, y, 14, bold); y -= 18; }
  y -= 4;

  // Lines.
  const cQty = W - M - 205, cRate = W - M - 105, cAmt = W - M - 6;
  const descW = cQty - 70 - (M + 6);
  const head = () => {
    page.drawRectangle({ x: M, y: y - 6, width: W - 2 * M, height: 20, color: brandC });
    text("Description", M + 6, y, 9, bold, onBrand);
    right("Qty", cQty, y, 9, bold, onBrand);
    right("Rate", cRate, y, 9, bold, onBrand);
    right("Amount", cAmt, y, 9, bold, onBrand);
    y -= 24;
  };
  head();
  for (const l of d.lines) {
    const ls = wrap(l.description, font, 10, descW);
    const h = ls.length * 13 + 10;
    if (y - h < M + 20) { newPage(); head(); }
    ls.forEach((t, i) => text(t, M + 6, y - i * 13, 10));
    right(`${l.quantity.toLocaleString("en-AU")} ${l.unit}`, cQty, y, 10);
    right(money(l.rate), cRate, y, 10);
    right(money(l.total), cAmt, y, 10);
    y -= h - 6;
    page.drawLine({ start: { x: M, y: y + 4 }, end: { x: W - M, y: y + 4 }, thickness: 0.6, color: rule });
    y -= 10;
  }

  // Totals.
  need(70);
  y -= 4;
  right("Total ex GST", cRate, y, 10, bold); right(money(d.totals.exGst), cAmt, y, 10, bold); y -= 16;
  right(`GST (${d.totals.gstPercent}%)`, cRate, y, 10); right(money(d.totals.gst), cAmt, y, 10); y -= 10;
  page.drawLine({ start: { x: cRate + 20, y }, end: { x: W - M, y }, thickness: 1.5, color: brandC });
  y -= 16;
  right("Total inc GST", cRate, y, 12, bold, accent); right(money(d.totals.incGst), cAmt, y, 12, bold, accent);
  y -= 34;

  // Terms.
  if (d.terms.trim()) {
    need(30);
    text("Terms", M, y, 10, bold); y -= 14;
    for (const l of wrap(d.terms, font, 8.5, W - 2 * M)) { need(12); if (l) text(l, M, y, 8.5, font, hex("#33383f")); y -= 11; }
  }

  // Page numbers.
  const pages = doc.getPages();
  if (pages.length > 1) pages.forEach((p, i) => {
    const s = `Page ${i + 1} of ${pages.length}`;
    p.drawText(s, { x: W - M - font.widthOfTextAtSize(s, 8), y: M - 18, size: 8, font, color: grey });
  });
  return doc.save();
}
