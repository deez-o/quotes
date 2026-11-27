/**
 * Fills a customer's own quote spreadsheet (.xlsx or .xlsm) by writing values straight into
 * the sheet's XML. Everything else in the file (formatting, logos, other sheets, macros,
 * formulas we don't touch) stays exactly as it was. Excel recalculates formulas on open.
 */
import JSZip from "jszip";
import { DOMParser, XMLSerializer, type Document, type Element } from "@xmldom/xmldom";

const NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

export type CellValue = string | number | null;
export type CellWrite = { cell: string; value: CellValue };

/** "B12" → { col: 2, row: 12 }. */
export function parseCell(ref: string): { col: number; row: number } {
  const m = /^\$?([A-Z]{1,3})\$?(\d{1,7})$/.exec(ref.trim().toUpperCase());
  if (!m) throw new Error(`"${ref}" isn't a cell address like B12.`);
  let col = 0;
  for (const ch of m[1]) col = col * 26 + (ch.charCodeAt(0) - 64);
  return { col, row: Number(m[2]) };
}

export function colName(col: number): string {
  let s = "";
  for (let n = col; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

export function cellRef(col: number, row: number) {
  return `${colName(col)}${row}`;
}

function children(el: Element, name: string): Element[] {
  const out: Element[] = [];
  for (let n = el.firstChild; n; n = n.nextSibling) if (n.nodeType === 1 && (n as Element).localName === name) out.push(n as Element);
  return out;
}

/** The path inside the zip of the named worksheet (or the first one). */
async function sheetPath(zip: JSZip, sheetName: string | null): Promise<string> {
  const wb = new DOMParser().parseFromString(await zip.file("xl/workbook.xml")!.async("string"), "text/xml");
  const sheets = Array.from(wb.getElementsByTagNameNS(NS, "sheet"));
  const sheet = (sheetName && sheets.find((s) => s.getAttribute("name") === sheetName)) || sheets[0];
  if (!sheet) throw new Error("That workbook has no sheets.");
  const rid = sheet.getAttributeNS(REL_NS, "id") ?? sheet.getAttribute("r:id");
  const rels = new DOMParser().parseFromString(await zip.file("xl/_rels/workbook.xml.rels")!.async("string"), "text/xml");
  const rel = Array.from(rels.getElementsByTagName("Relationship")).find((r) => r.getAttribute("Id") === rid);
  if (!rel) throw new Error("Couldn't find that sheet in the workbook.");
  const target = rel.getAttribute("Target")!;
  return target.startsWith("/") ? target.slice(1) : `xl/${target.replace(/^\.\//, "")}`;
}

function rowEl(doc: Document, sheetData: Element, row: number): Element {
  const rows = children(sheetData, "row");
  for (const r of rows) {
    const n = Number(r.getAttribute("r"));
    if (n === row) return r;
    if (n > row) {
      const made = doc.createElementNS(NS, "row");
      made.setAttribute("r", String(row));
      sheetData.insertBefore(made, r);
      return made;
    }
  }
  const made = doc.createElementNS(NS, "row");
  made.setAttribute("r", String(row));
  sheetData.appendChild(made);
  return made;
}

function cellEl(doc: Document, row: Element, ref: string, col: number): Element {
  for (const c of children(row, "c")) {
    const r = c.getAttribute("r");
    const cc = r ? parseCell(r).col : 0;
    if (r === ref) return c;
    if (cc > col) {
      const made = doc.createElementNS(NS, "c");
      made.setAttribute("r", ref);
      row.insertBefore(made, c);
      return made;
    }
  }
  const made = doc.createElementNS(NS, "c");
  made.setAttribute("r", ref);
  row.appendChild(made);
  return made;
}

/** Strip characters XML can't hold. */
function clean(s: string) {
  return s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
}

/** Returns false when the cell was left alone because it holds one of the sheet's fill-down formulas. */
function setCell(doc: Document, sheetData: Element, w: CellWrite): boolean {
  const { col, row } = parseCell(w.cell);
  const ref = cellRef(col, row);
  const c = cellEl(doc, rowEl(doc, sheetData, row), ref, col);
  // A shared (filled-down) formula can't be partly replaced without breaking the rest: leave it to work.
  const f = children(c, "f")[0];
  if (f && f.getAttribute("t") === "shared") return false;
  // Keep the cell's style (s); replace what it holds, formula included.
  while (c.firstChild) c.removeChild(c.firstChild);
  c.removeAttribute("t");
  if (w.value === null || w.value === "") return true;
  if (typeof w.value === "number" && Number.isFinite(w.value)) {
    const v = doc.createElementNS(NS, "v");
    v.appendChild(doc.createTextNode(String(w.value)));
    c.appendChild(v);
    return true;
  }
  c.setAttribute("t", "inlineStr");
  const is = doc.createElementNS(NS, "is");
  const t = doc.createElementNS(NS, "t");
  t.setAttribute("xml:space", "preserve");
  t.appendChild(doc.createTextNode(clean(String(w.value))));
  is.appendChild(t);
  c.appendChild(is);
  return true;
}

// Elements that must come after calcPr in workbook.xml (Excel is strict about the order).
const AFTER_CALCPR = ["oleSize", "customWorkbookViews", "pivotCaches", "smartTagPr", "smartTagTypes", "webPublishing", "fileRecoveryPr", "webPublishObjects", "extLst"];

/**
 * Write values into one sheet of a workbook and return the new file. Cells keep their look.
 * Formulas we overwrite are dropped, Excel's saved calculation order is cleared, and the
 * workbook is set to recalculate when opened, so totals in the sheet stay right.
 */
export async function fillWorkbook(bytes: Uint8Array, sheetName: string | null, writes: CellWrite[]): Promise<{ bytes: Uint8Array; keptFormulas: string[] }> {
  const zip = await JSZip.loadAsync(bytes);
  if (!zip.file("xl/workbook.xml")) throw new Error("That isn't an Excel workbook (.xlsx or .xlsm).");
  const path = await sheetPath(zip, sheetName);
  const doc = new DOMParser().parseFromString(await zip.file(path)!.async("string"), "text/xml");
  const sheetData = doc.getElementsByTagNameNS(NS, "sheetData")[0];
  if (!sheetData) throw new Error("That sheet has no cells to fill.");
  const keptFormulas: string[] = [];
  for (const w of writes) if (!setCell(doc, sheetData, w)) keptFormulas.push(w.cell);
  zip.file(path, new XMLSerializer().serializeToString(doc));

  // Excel rebuilds its calculation chain if it's missing; a stale one makes it complain.
  if (zip.file("xl/calcChain.xml")) {
    zip.remove("xl/calcChain.xml");
    const relsPath = "xl/_rels/workbook.xml.rels";
    const rels = await zip.file(relsPath)!.async("string");
    zip.file(relsPath, rels.replace(/<Relationship[^>]*calcChain[^>]*\/>/g, ""));
    const ct = await zip.file("[Content_Types].xml")!.async("string");
    zip.file("[Content_Types].xml", ct.replace(/<Override[^>]*calcChain[^>]*\/>/g, ""));
  }
  const wbXml = await zip.file("xl/workbook.xml")!.async("string");
  const wbDoc = new DOMParser().parseFromString(wbXml, "text/xml");
  let calcPr = wbDoc.getElementsByTagNameNS(NS, "calcPr")[0];
  if (!calcPr) {
    calcPr = wbDoc.createElementNS(NS, "calcPr");
    const root = wbDoc.documentElement!;
    const before = Array.from(root.childNodes).find((n) => n.nodeType === 1 && AFTER_CALCPR.includes((n as Element).localName ?? ""));
    if (before) root.insertBefore(calcPr, before);
    else root.appendChild(calcPr);
  }
  calcPr.setAttribute("fullCalcOnLoad", "1");
  zip.file("xl/workbook.xml", new XMLSerializer().serializeToString(wbDoc));

  return { bytes: await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" }), keptFormulas };
}
