/**
 * The customer's quote as a PDF, made on the server so it can be emailed.
 * Same content as the print page: business details, the lines, totals and terms.
 * Kept free of Next.js and Supabase so it can be tested.
 */
import { PDFDocument, PDFString, StandardFonts, rgb, type PDFFont, type PDFPage, type RGB } from "pdf-lib";

export type QuotePdfData = {
  brand: string;
  business: { name: string; abn: string | null; address: string | null; contact: string | null };
  logo: { bytes: Uint8Array; type: "png" | "jpg" } | null;
  quote: { number: string | null; date: string; title: string; customer: string | null; customerEmail: string | null; site: string | null };
  /** One for a plain quote; two or more when the customer is given options. */
  options: PdfOption[];
  gstPercent: number;
  inclusions: string[];
  exclusions: string[];
  /** The satellite picture with the traced areas. */
  map: { png: Uint8Array; areas: { name: string; m2: number; color: string }[] } | null;
  /** Where the customer can accept online. */
  acceptUrl: string | null;
  terms: string;
};

export type PdfOption = {
  label: string | null;
  title: string;
  lines: { description: string; quantity: number; unit: string; rate: number; total: number }[];
  /** Rates asked for that aren't in the total (extra establishment, optional MTV). */
  rates?: { description: string; unit: string; rate: number }[];
  totals: { exGst: number; gst: number; incGst: number };
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

  const many = d.options.length > 1;
  if (many) {
    need(20 + d.options.length * 16);
    text("We've priced the following options. Choose the one that suits you.", M, y, 10, font, grey); y -= 18;
    for (const o of d.options) {
      const label = `Option ${o.label ?? ""}: ${o.title}`;
      const ls = wrap(label, font, 10, W - 2 * M - 160);
      ls.forEach((t, i) => text(t, M + 6, y - i * 13, 10, i ? font : bold));
      right(`${money(o.totals.incGst)} inc GST`, W - M - 6, y, 10, bold, accent);
      y -= ls.length * 13 + 4;
    }
    y -= 10;
  }

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
  for (const o of d.options) {
    if (many) {
      need(80);
      for (const l of wrap(`Option ${o.label ?? ""}: ${o.title}`, bold, 12, W - 2 * M)) { text(l, M, y, 12, bold, accent); y -= 16; }
      y -= 2;
    }
    head();
    for (const l of o.lines) {
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
    need(70);
    y -= 4;
    right(many ? `Option ${o.label ?? ""} total ex GST` : "Total ex GST", cRate, y, 10, bold); right(money(o.totals.exGst), cAmt, y, 10, bold); y -= 16;
    right(`GST (${d.gstPercent}%)`, cRate, y, 10); right(money(o.totals.gst), cAmt, y, 10); y -= 10;
    page.drawLine({ start: { x: cRate + 20, y }, end: { x: W - M, y }, thickness: 1.5, color: brandC });
    y -= 16;
    right(many ? `Option ${o.label ?? ""} inc GST` : "Total inc GST", cRate, y, 12, bold, accent); right(money(o.totals.incGst), cAmt, y, 12, bold, accent);
    y -= 34;
    if (o.rates?.length) {
      need(30 + o.rates.length * 16);
      text("Rates, if needed (not included in the total, ex GST)", M, y, 10, bold); y -= 15;
      for (const r of o.rates) {
        text(r.description, M + 6, y, 10);
        right(`${money(r.rate)} per ${r.unit}`, cAmt, y, 10);
        y -= 15;
      }
      y -= 14;
    }
  }

  // What's included and what isn't.
  const list = (name: string, items: string[]) => {
    if (!items.length) return;
    need(34);
    text(name, M, y, 10, bold); y -= 14;
    for (const it of items) {
      const ls = wrap(it, font, 9.5, W - 2 * M - 14);
      need(ls.length * 12 + 2);
      text("•", M + 2, y, 9.5);
      ls.forEach((t, i) => text(t, M + 14, y - i * 12, 9.5));
      y -= ls.length * 12 + 2;
    }
    y -= 10;
  };
  list("Included", d.inclusions);
  list("Not included", d.exclusions);

  // The site, with the areas we've measured.
  if (d.map) {
    try {
      const img = await doc.embedPng(d.map.png);
      const w = W - 2 * M, h = (w * img.height) / img.width;
      const legend = d.map.areas.length;
      if (y - (h + 30 + legend * 13) < M + 20) newPage();
      text("The site", M, y, 10, bold); y -= 10;
      page.drawImage(img, { x: M, y: y - h, width: w, height: h });
      y -= h + 14;
      for (const a of d.map.areas) {
        page.drawRectangle({ x: M, y: y - 1, width: 9, height: 9, color: hex(/^#[0-9a-f]{6}$/i.test(a.color) ? a.color : "#FF6A13") });
        text(a.name, M + 14, y, 9.5);
        right(`${Math.round(a.m2).toLocaleString("en-AU")} m²`, M + 260, y, 9.5);
        y -= 13;
      }
      y -= 12;
    } catch {
      // A map that won't embed is left out rather than failing the quote.
    }
  }

  if (d.acceptUrl) {
    // A real button in the company's colour, the whole of it clickable, with the address under it for a printed copy.
    need(70);
    text(many ? "To go ahead, choose your option and accept online:" : "To go ahead, accept online:", M, y - 4, 10, bold);
    const label = "View and accept quote";
    const bw = bold.widthOfTextAtSize(label, 12) + 36, bh = 30, by = y - 14 - bh;
    page.drawRectangle({ x: M, y: by, width: bw, height: bh, color: brandC });
    text(label, M + 18, by + 10, 12, bold, onBrand);
    const linkText = pdfSafe(d.acceptUrl);
    text(linkText, M, by - 12, 8, font, hex("#6b7280"));
    const lw = font.widthOfTextAtSize(linkText, 8);
    for (const rect of [[M, by, M + bw, by + bh], [M, by - 15, M + lw, by - 4]]) {
      page.node.addAnnot(doc.context.register(doc.context.obj({
        Type: "Annot", Subtype: "Link", Rect: rect, Border: [0, 0, 0],
        A: { Type: "Action", S: "URI", URI: PDFString.of(d.acceptUrl) },
      })));
    }
    y = by - 28;
  }

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
