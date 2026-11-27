/**
 * quoteout's standard Excel quote, in the company's own branding. Used for the Excel button
 * until a company sets up its own sheet. Line amounts match the PDF; the totals are formulas,
 * so if someone edits a line in Excel the totals follow.
 */
import type { SheetQuote } from "./map";

export type SheetBrand = {
  name: string; abn: string | null; phone: string | null; email: string | null; address: string | null; website: string | null;
  color: string | null; logo: { bytes: Uint8Array; ext: "png" | "jpeg" } | null; gstPercent: number;
};

const argb = (hex: string | null | undefined, fallback = "16181B") => `FF${(hex && /^#[0-9a-f]{6}$/i.test(hex) ? hex.slice(1) : fallback).toUpperCase()}`;

/** Readable text colour (white or near-black) on the brand colour. */
function inkOn(hex: string | null) {
  const h = hex && /^#[0-9a-f]{6}$/i.test(hex) ? hex.slice(1) : "16181B";
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.4 ? "FF16181B" : "FFFFFFFF";
}

export async function defaultWorkbook(brand: SheetBrand, q: SheetQuote): Promise<Uint8Array> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = "quoteout";
  const ws = wb.addWorksheet("Quote", {
    pageSetup: { paperSize: 9, orientation: "portrait", fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.5, right: 0.5, top: 0.6, bottom: 0.6, header: 0.3, footer: 0.3 } },
    views: [{ showGridLines: false }],
  });
  ws.columns = [{ width: 2 }, { width: 46 }, { width: 11 }, { width: 8 }, { width: 13 }, { width: 15 }, { width: 2 }];
  const fill = argb(brand.color), ink = inkOn(brand.color);
  const font = { name: "Calibri", size: 11, color: { argb: "FF2B2F35" } };
  const money = '"$"#,##0.00';
  const v = q.values;

  // Header: logo (or name) on the left, business details on the right.
  if (brand.logo) {
    const id = wb.addImage({ buffer: Buffer.from(brand.logo.bytes) as unknown as ArrayBuffer, extension: brand.logo.ext });
    ws.addImage(id, { tl: { col: 1, row: 0.3 }, ext: { width: 180, height: 60 } });
  } else {
    ws.getCell("B2").value = brand.name;
    ws.getCell("B2").font = { ...font, size: 18, bold: true, color: { argb: "FF16181B" } };
  }
  const details = [brand.logo ? brand.name : null, brand.abn ? `ABN ${brand.abn}` : null, brand.address, [brand.phone, brand.email].filter(Boolean).join("  ·  ") || null, brand.website].filter(Boolean) as string[];
  details.forEach((d, i) => {
    const c = ws.getCell(`F${i + 1}`);
    c.value = d;
    c.alignment = { horizontal: "right" };
    const lead = i === 0 && Boolean(brand.logo);
    c.font = { ...font, size: lead ? 12 : 10, bold: lead, color: { argb: lead ? "FF16181B" : "FF5B6168" } };
  });

  // Title band.
  const top = Math.max(6, details.length + 2);
  ws.mergeCells(`B${top}:F${top}`);
  const title = ws.getCell(`B${top}`);
  title.value = "QUOTATION";
  title.font = { ...font, size: 16, bold: true, color: { argb: ink } };
  title.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fill } };
  title.alignment = { vertical: "middle", indent: 1 };
  ws.getRow(top).height = 28;

  // Who, where, when.
  const info: [string, string | number | undefined, string, string | number | undefined][] = [
    ["Customer", v.customer_name, "Quote no.", v.quote_no],
    ["Email", v.customer_email, "Date", v.date],
    ["Site", v.site_address, "Valid until", v.valid_until],
    ["Job", v.job_title, "Prepared by", v.prepared_by],
  ];
  let r = top + 2;
  for (const [l1, v1, l2, v2] of info) {
    ws.getCell(`B${r}`).value = { richText: [{ text: `${l1}:  `, font: { ...font, bold: true } }, { text: String(v1 ?? ""), font }] };
    ws.getCell(`E${r}`).value = l2;
    ws.getCell(`E${r}`).font = { ...font, bold: true };
    ws.getCell(`F${r}`).value = v2 ?? "";
    ws.getCell(`F${r}`).font = font;
    ws.getCell(`F${r}`).alignment = { horizontal: "right" };
    r++;
  }

  // Lines.
  r += 1;
  const head = r;
  ["Description", "Qty", "Unit", "Rate", "Amount"].forEach((h, i) => {
    const c = ws.getCell(head, i + 2);
    c.value = h;
    c.font = { ...font, bold: true, color: { argb: ink } };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fill } };
    c.alignment = { horizontal: i === 0 ? "left" : "right", vertical: "middle", indent: i === 0 ? 1 : 0 };
  });
  ws.getRow(head).height = 22;
  const first = head + 1;
  const lines = q.lines.length ? q.lines : [{ description: "", quantity: 0, unit: "", rate: 0, total: 0 }];
  lines.forEach((l, i) => {
    const row = ws.getRow(first + i);
    row.values = [undefined, l.description, l.quantity, l.unit, l.rate, l.total];
    row.getCell(2).alignment = { wrapText: true, vertical: "top", indent: 1 };
    row.getCell(3).numFmt = "#,##0.##";
    row.getCell(5).numFmt = money;
    row.getCell(6).numFmt = money;
    for (let c = 2; c <= 6; c++) {
      row.getCell(c).font = font;
      row.getCell(c).border = { bottom: { style: "thin", color: { argb: "FFE1E4E8" } } };
      if (c > 2) row.getCell(c).alignment = { horizontal: "right", vertical: "top" };
    }
  });
  const last = first + lines.length - 1;

  // Totals (formulas, so edits in Excel add up).
  r = last + 2;
  const gstRate = brand.gstPercent / 100;
  const totals: [string, string, boolean][] = [
    ["Total ex GST", `SUM(F${first}:F${last})`, false],
    [`GST (${brand.gstPercent}%)`, `ROUND(F${r}*${gstRate},2)`, false],
    ["Total inc GST", `F${r}+F${r + 1}`, true],
  ];
  const cached = [Number(v.subtotal_ex_gst ?? 0), Number(v.gst ?? 0), Number(v.total_inc_gst ?? 0)];
  totals.forEach(([label, formula, strong], i) => {
    const lc = ws.getCell(`E${r + i}`), vc = ws.getCell(`F${r + i}`);
    lc.value = label;
    vc.value = { formula, result: cached[i] };
    vc.numFmt = money;
    lc.font = { ...font, bold: strong };
    vc.font = { ...font, bold: strong, size: strong ? 12 : 11 };
    lc.alignment = { horizontal: "right" };
    vc.alignment = { horizontal: "right" };
    if (strong) {
      for (const c of [lc, vc]) {
        c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fill } };
        c.font = { ...c.font, color: { argb: ink } };
      }
    }
  });

  // Terms.
  r += totals.length + 2;
  if (v.terms) {
    ws.getCell(`B${r}`).value = "Terms";
    ws.getCell(`B${r}`).font = { ...font, bold: true };
    ws.mergeCells(`B${r + 1}:F${r + 1}`);
    const t = ws.getCell(`B${r + 1}`);
    t.value = String(v.terms);
    t.font = { ...font, size: 10, color: { argb: "FF5B6168" } };
    t.alignment = { wrapText: true, vertical: "top" };
    ws.getRow(r + 1).height = Math.min(400, 15 * Math.ceil(String(v.terms).length / 95 + String(v.terms).split("\n").length));
  }
  ws.pageSetup.printArea = `A1:G${r + 2}`;
  return new Uint8Array(await wb.xlsx.writeBuffer());
}
