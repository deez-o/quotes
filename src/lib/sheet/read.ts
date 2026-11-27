/** Reading a spreadsheet's layout: for the AI to map it, and to show the customer a preview. */
import { colName } from "./fill";

type Ws = { name: string; state?: string; rowCount: number; columnCount: number; getCell(r: number, c: number): { value: unknown; isMerged: boolean; master: { address: string }; address: string } };

async function load(bytes: Uint8Array) {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.from(bytes) as unknown as ArrayBuffer);
  return wb;
}

function show(v: unknown): string {
  if (v == null) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    if ("formula" in o || "sharedFormula" in o) return `=${String(o.formula ?? o.sharedFormula ?? "")}`;
    if ("richText" in o) return (o.richText as { text: string }[]).map((t) => t.text).join("");
    if ("text" in o) return String(o.text);
    if ("result" in o) return String(o.result ?? "");
    if ("error" in o) return String(o.error);
  }
  return String(v);
}

export async function sheetNames(bytes: Uint8Array): Promise<string[]> {
  const wb = await load(bytes);
  const names: string[] = [];
  wb.eachSheet((ws) => { if (!ws.state || ws.state === "visible") names.push(ws.name); });
  return names;
}

/** Every visible sheet's filled cells as "B4: Customer:" lines, for the AI. */
export async function outline(bytes: Uint8Array, maxRows = 150, maxCols = 30): Promise<{ text: string; sheets: string[] }> {
  const wb = await load(bytes);
  const out: string[] = [];
  const sheets: string[] = [];
  wb.eachSheet((raw) => {
    const ws = raw as unknown as Ws;
    if (ws.state && ws.state !== "visible") return;
    sheets.push(ws.name);
    out.push(`### Sheet: ${ws.name}`);
    for (let r = 1; r <= Math.min(ws.rowCount, maxRows); r++) {
      const cells: string[] = [];
      for (let c = 1; c <= Math.min(ws.columnCount, maxCols); c++) {
        const cell = ws.getCell(r, c);
        if (cell.isMerged && cell.master.address !== cell.address) continue;
        const t = show(cell.value).replace(/\s+/g, " ").trim();
        if (t) cells.push(`${colName(c)}${r}: ${t.slice(0, 80)}`);
      }
      if (cells.length) out.push(cells.join(" | "));
    }
  });
  return { text: out.join("\n").slice(0, 60_000), sheets };
}

/** A sheet as a grid of what each cell shows (formulas as =...), for the preview. */
export async function grid(bytes: Uint8Array, sheet: string, maxRows = 80, maxCols = 14): Promise<{ rows: string[][]; cols: string[] }> {
  const wb = await load(bytes);
  const ws = (wb.getWorksheet(sheet) ?? wb.worksheets[0]) as unknown as Ws | undefined;
  if (!ws) return { rows: [], cols: [] };
  const nr = Math.min(ws.rowCount, maxRows), nc = Math.min(ws.columnCount, maxCols);
  const rows: string[][] = [];
  for (let r = 1; r <= nr; r++) {
    const row: string[] = [];
    for (let c = 1; c <= nc; c++) {
      const cell = ws.getCell(r, c);
      row.push(cell.isMerged && cell.master.address !== cell.address ? "" : show(cell.value));
    }
    rows.push(row);
  }
  while (rows.length && rows[rows.length - 1].every((x) => !x)) rows.pop();
  return { rows, cols: Array.from({ length: nc }, (_, i) => colName(i + 1)) };
}
