/**
 * quoteout's standard Excel quote, in the company's own branding. Used for the Excel button
 * until a company sets up its own sheet. Line amounts match the PDF; the totals are formulas,
 * so if someone edits a line in Excel the totals follow.
 */
import type { SheetQuote } from "./map";
import type { Priced } from "@/lib/site/price";

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

export type WorkingsInput = {
  priced: Priced;
  marginPercent: number;
  plant: string | null;
  haul: { km: number; minutes: number } | null;
};

/**
 * The workbook for the Excel button: the workings first (every cost, with live formulas,
 * so a change to a depth, rate or margin flows through), then the customer quote.
 */
export async function defaultWorkbook(brand: SheetBrand, q: SheetQuote, workings?: WorkingsInput): Promise<Uint8Array> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = "quoteout";
  if (workings) addWorkings(wb, brand, q, workings);
  addQuote(wb, brand, q);
  return new Uint8Array(await wb.xlsx.writeBuffer());
}

type Wb = import("exceljs").Workbook;

function addQuote(wb: Wb, brand: SheetBrand, q: SheetQuote) {
  const ws = wb.addWorksheet("Customer quote", {
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
}

const GROUP_NAME: Record<string, string> = { crew: "Crew", plant: "Plant and hire", other: "Other" };

function addWorkings(wb: Wb, brand: SheetBrand, q: SheetQuote, w: WorkingsInput) {
  const ws = wb.addWorksheet("Workings", { views: [{ showGridLines: false, state: "frozen", ySplit: 0 }], pageSetup: { paperSize: 9, orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
  ws.columns = [{ width: 2 }, { width: 38 }, { width: 11 }, { width: 11 }, { width: 11 }, { width: 11 }, { width: 11 }, { width: 8 }, { width: 12 }, { width: 14 }, { width: 34 }];
  const font = { name: "Calibri", size: 11, color: { argb: "FF2B2F35" } };
  const bold = { ...font, bold: true };
  const muted = { ...font, size: 10, color: { argb: "FF5B6168" } };
  const fill = argb(brand.color), ink = inkOn(brand.color);
  const money = '"$"#,##0.00';
  const input = { type: "pattern" as const, pattern: "solid" as const, fgColor: { argb: "FFFFF7E6" } };
  const line = { bottom: { style: "thin" as const, color: { argb: "FFE1E4E8" } } };
  const v = q.values;
  let r = 1;

  ws.getCell(`B${r}`).value = `${brand.name}: quote workings`;
  ws.getCell(`B${r}`).font = { ...bold, size: 16 };
  r++;
  ws.getCell(`B${r}`).value = "For you, not the customer. Yellow cells are inputs: change them and everything recalculates. The Customer quote tab shows what the customer sees.";
  ws.getCell(`B${r}`).font = muted;
  r += 2;
  const facts: [string, string | number | undefined][] = [
    ["Quote", `${v.quote_no ?? ""} ${v.job_title ? `· ${v.job_title}` : ""}`.trim()],
    ["Customer", v.customer_name], ["Site", v.site_address], ["Date", v.date],
    ["Supply plant", w.plant ?? "Not chosen"],
    ["Distance to plant", w.haul ? `${w.haul.km} km, ${w.haul.minutes} min each way (truck)` : "Unknown"],
  ];
  for (const [k, val] of facts) {
    ws.getCell(`B${r}`).value = k;
    ws.getCell(`B${r}`).font = bold;
    ws.getCell(`C${r}`).value = String(val ?? "");
    ws.getCell(`C${r}`).font = font;
    r++;
  }

  const head = (labels: string[]) => {
    labels.forEach((h, i) => {
      const c = ws.getCell(r, i + 2);
      c.value = h;
      c.font = { ...bold, color: { argb: ink } };
      c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fill } };
      c.alignment = { horizontal: i === 0 || i === labels.length - 1 ? "left" : "right", vertical: "middle", wrapText: true, indent: i === labels.length - 1 ? 1 : 0 };
    });
    ws.getRow(r).height = 30;
    r++;
  };
  const section = (title: string) => {
    r++;
    ws.getCell(`B${r}`).value = title;
    ws.getCell(`B${r}`).font = { ...bold, size: 13 };
    r++;
  };
  const costCells: string[] = [];
  const tonneCells: string[] = [];
  const cartTonneCells: string[] = [];
  const num = (c: string, value: number | null, fmt = "#,##0.##", isInput = false) => {
    const cell = ws.getCell(c);
    cell.value = value;
    cell.numFmt = fmt;
    cell.font = font;
    cell.alignment = { horizontal: "right" };
    if (isInput && value !== null) cell.fill = input;
  };
  const formula = (c: string, f: string, result: number, fmt = "#,##0.##", strong = false) => {
    const cell = ws.getCell(c);
    cell.value = { formula: f, result };
    cell.numFmt = fmt;
    cell.font = strong ? bold : font;
    cell.alignment = { horizontal: "right" };
  };
  const rowLine = () => { for (let c = 2; c <= 11; c++) ws.getCell(r, c).border = line; };

  // Materials: area × depth × density = tonnes, × rate.
  const mats = w.priced.costLines.filter((l) => l.group === "material");
  if (mats.length) {
    section("Materials");
    head(["Item", "Area m²", "Depth mm", "Density t/m³", "Tonnes", "Quantity", "Unit", "Rate", "Cost", "Notes"]);
    for (const l of mats) {
      ws.getCell(`B${r}`).value = l.label;
      ws.getCell(`B${r}`).font = font;
      const c = l.calc;
      if (c?.kind === "tonnes") {
        num(`C${r}`, c.area_m2, "#,##0", true); num(`D${r}`, c.depth_mm, "#,##0", true); num(`E${r}`, c.density, "0.00", true);
        formula(`F${r}`, `ROUND(C${r}*D${r}/1000*E${r},2)`, c.tonnes);
        formula(`G${r}`, `F${r}`, c.tonnes);
        tonneCells.push(`F${r}`);
        if (!c.delivered) cartTonneCells.push(`F${r}`);
        ws.getCell(`K${r}`).value = [c.band, c.delivered ? "supplier delivers" : null].filter(Boolean).join(" · ") || null;
      } else if (c?.kind === "volume" && c.area_m2 != null && c.depth_mm != null) {
        num(`C${r}`, c.area_m2, "#,##0", true); num(`D${r}`, c.depth_mm, "#,##0", true);
        formula(`G${r}`, `ROUND(C${r}*D${r}/1000,2)`, c.qty);
        ws.getCell(`K${r}`).value = c.band;
      } else if (c && (c.kind === "volume" || c.kind === "qty")) {
        num(`G${r}`, c.qty, "#,##0.##", true);
        ws.getCell(`K${r}`).value = c.band;
      }
      if (c && "rate" in c) {
        ws.getCell(`H${r}`).value = "unit" in c ? c.unit : "";
        num(`I${r}`, c.rate, money, true);
        formula(`J${r}`, `ROUND(G${r}*I${r},2)`, l.cost, money);
      } else {
        num(`J${r}`, l.cost, money);
        ws.getCell(`K${r}`).value = l.working;
      }
      ws.getCell(`H${r}`).alignment = { horizontal: "right" };
      ws.getCell(`K${r}`).font = muted;
      ws.getCell(`K${r}`).alignment = { indent: 1 };
      costCells.push(`J${r}`);
      rowLine();
      r++;
    }
  }

  // Cartage: loads × cycle time.
  const truck = w.priced.costLines.find((l) => l.group === "trucks");
  if (truck) {
    section("Cartage");
    const c = truck.calc?.kind === "trucks" ? truck.calc : null;
    if (c) {
      const rows: [string, (row: number) => void][] = [];
      const at: Record<string, number> = {};
      const put = (key: string, label: string, fill: (row: number) => void) => rows.push([label, (row) => { at[key] = row; fill(row); }]);
      put("t", "Tonnes to cart", (row) => cartTonneCells.length ? formula(`C${row}`, cartTonneCells.join("+"), c.tonnes) : num(`C${row}`, c.tonnes));
      put("cap", "Truck carries (t)", (row) => num(`C${row}`, c.capacity, "#,##0.#", true));
      put("loads", "Loads", (row) => formula(`C${row}`, `ROUNDUP(C${at.t}/C${at.cap},0)`, c.loads, "0"));
      put("each", "Drive each way (min)", (row) => num(`C${row}`, c.minutesEachWay, "0", true));
      put("load", "Loading at plant (min)", (row) => num(`C${row}`, c.loadMinutes, "0", true));
      put("tip", "Tipping on site (min)", (row) => num(`C${row}`, c.unloadMinutes, "0", true));
      put("cycle", "Cycle time (min)", (row) => formula(`C${row}`, `2*C${at.each}+C${at.load}+C${at.tip}`, c.cycleMinutes, "0"));
      put("hours", "Truck hours", (row) => formula(`C${row}`, `ROUND(C${at.loads}*C${at.cycle}/60,2)`, c.hours, "0.00"));
      put("km", "Distance each way (km)", (row) => num(`C${row}`, c.km, "0.#", true));
      put("trucks", "Trucks needed", (row) => num(`C${row}`, c.trucks, "0", true));
      put("rate", `Truck rate (per ${c.basis === "h" ? "hour" : c.basis === "km" ? "km" : "truck"})`, (row) => num(`C${row}`, c.rate, money, true));
      put("cost", "Cartage cost", (row) => formula(`C${row}`,
        c.basis === "km" ? `ROUND(C${at.loads}*2*C${at.km}*C${at.rate},2)` : c.basis === "truck" ? `ROUND(C${at.trucks}*C${at.rate},2)` : `ROUND(C${at.hours}*C${at.rate},2)`,
        truck.cost, money, true));
      for (const [label, fn] of rows) {
        ws.getCell(`B${r}`).value = label;
        ws.getCell(`B${r}`).font = font;
        fn(r);
        rowLine();
        r++;
      }
      costCells.push(`C${at.cost}`);
    } else {
      ws.getCell(`B${r}`).value = truck.label;
      num(`C${r}`, truck.cost, money);
      ws.getCell(`D${r}`).value = truck.working;
      costCells.push(`C${r}`);
      r++;
    }
  }

  // Crew, plant and float: days × time × rate, with overtime split out.
  const timed = w.priced.costLines.filter((l) => l.group === "crew" || l.group === "plant" || l.group === "other");
  if (timed.length) {
    section("Crew, plant and other costs");
    head(["Item", "Days", "Per day", "Unit", "Rate", "", "", "", "Cost", "How it's worked out"]);
    for (const l of timed) {
      ws.getCell(`B${r}`).value = `${GROUP_NAME[l.group] ?? ""}: ${l.label}`;
      ws.getCell(`B${r}`).font = font;
      const c = l.calc;
      if (c?.kind === "time" && c.parts && c.parts.length) {
        num(`C${r}`, c.days, "0.#", true);
        num(`D${r}`, c.amount, "0.##");
        ws.getCell(`E${r}`).value = c.unit;
        num(`F${r}`, c.rate, money);
        const sum = c.parts.map((p) => `${p.hours}*${p.rate}`).join("+");
        formula(`J${r}`, `ROUND(C${r}*(${sum}),2)`, l.cost, money);
        ws.getCell(`K${r}`).value = c.parts.length > 1 ? `Overtime: ${c.parts.map((p) => `${p.hours} h @ $${p.rate}`).join(", ")}` : null;
      } else if (c?.kind === "time") {
        num(`C${r}`, c.days, "0.#", true);
        num(`D${r}`, c.amount, "0.##", true);
        ws.getCell(`E${r}`).value = c.unit;
        num(`F${r}`, c.rate, money, true);
        formula(`J${r}`, `ROUND(C${r}*D${r}*F${r},2)`, l.cost, money);
      } else if (c?.kind === "qty") {
        num(`D${r}`, c.qty, "0.##", true);
        ws.getCell(`E${r}`).value = c.unit;
        num(`F${r}`, c.rate, money, true);
        formula(`J${r}`, `ROUND(D${r}*F${r},2)`, l.cost, money);
      } else {
        num(`J${r}`, l.cost, money);
        ws.getCell(`K${r}`).value = l.working;
      }
      ws.getCell(`E${r}`).alignment = { horizontal: "right" };
      ws.getCell(`K${r}`).font = muted;
      ws.getCell(`K${r}`).alignment = { indent: 1 };
      costCells.push(`J${r}`);
      rowLine();
      r++;
    }
  }

  // The price.
  section("Price");
  const at: Record<string, number> = {};
  const t = Math.round(tonneCells.length ? w.priced.perTonne?.tonnes ?? 0 : 0);
  const p = w.priced;
  const sumRow = (key: string, label: string, f: string | null, value: number, fmt: string, strong = false, isInput = false) => {
    at[key] = r;
    ws.getCell(`B${r}`).value = label;
    ws.getCell(`B${r}`).font = strong ? bold : font;
    if (f) formula(`C${r}`, f, value, fmt, strong);
    else num(`C${r}`, value, fmt, isInput);
    rowLine();
    r++;
  };
  sumRow("cost", "Total cost", costCells.length ? `SUM(${costCells.join(",")})` : null, p.cost, money, true);
  sumRow("margin", "Margin (of the price)", null, w.marginPercent / 100, "0.0%", false, true);
  sumRow("price", "Price ex GST", `ROUND(C${at.cost}/(1-C${at.margin}),0)`, p.priceExGst, money, true);
  sumRow("gst", `GST (${brand.gstPercent}%)`, `ROUND(C${at.price}*${brand.gstPercent / 100},2)`, p.gst, money);
  sumRow("inc", "Price inc GST", `C${at.price}+C${at.gst}`, p.priceIncGst, money, true);
  sumRow("profit", "Profit", `C${at.price}-C${at.cost}`, p.profit, money, true);
  if (tonneCells.length && t > 0) {
    sumRow("t", "Tonnes of asphalt and base", tonneCells.join("+"), p.perTonne?.tonnes ?? 0, "#,##0.00");
    sumRow("ct", "Cost a tonne", `ROUND(C${at.cost}/C${at.t},2)`, p.perTonne?.cost ?? 0, money);
    sumRow("pt", "Price a tonne", `ROUND(C${at.price}/C${at.t},2)`, p.perTonne?.price ?? 0, money);
    sumRow("prt", "Profit a tonne", `ROUND(C${at.profit}/C${at.t},2)`, p.perTonne?.profit ?? 0, money, true);
  }
  if (p.warnings.length) {
    r++;
    ws.getCell(`B${r}`).value = "Not priced yet";
    ws.getCell(`B${r}`).font = bold;
    r++;
    for (const msg of p.warnings) { ws.getCell(`B${r}`).value = `• ${msg}`; ws.getCell(`B${r}`).font = muted; r++; }
  }
  ws.pageSetup.printArea = `A1:K${r}`;
}
