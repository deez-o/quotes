/**
 * Getting text out of what came with an RFQ: PDFs, spreadsheets, Word files, plain text.
 * Images are passed to the AI as pictures instead. Pure byte-in, text-out helpers.
 */
import { pdfText } from "@/lib/site/price-list";

export type ReadKind = "pdf" | "sheet" | "word" | "text" | "image" | "other";

export function kindOf(name: string, mime: string | null): ReadKind {
  const n = name.toLowerCase();
  const m = (mime ?? "").toLowerCase();
  if (n.endsWith(".pdf") || m === "application/pdf") return "pdf";
  if (/\.(xlsx|xlsm|csv)$/.test(n) || m.includes("spreadsheet") || m === "text/csv") return "sheet";
  if (n.endsWith(".docx") || m.includes("wordprocessingml")) return "word";
  if (/\.(txt|eml)$/.test(n) || m.startsWith("text/")) return "text";
  if (/\.(png|jpe?g|webp|gif)$/.test(n) || m.startsWith("image/")) return "image";
  return "other";
}

/** A spreadsheet as plain rows ("A | B | C"), one block per sheet. */
export async function sheetText(bytes: Uint8Array, name: string, maxRows = 400): Promise<string> {
  if (name.toLowerCase().endsWith(".csv")) return new TextDecoder().decode(bytes).split(/\r?\n/).slice(0, maxRows).join("\n");
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.from(bytes) as unknown as ArrayBuffer);
  const out: string[] = [];
  wb.eachSheet((ws) => {
    if (ws.state && ws.state !== "visible") return;
    out.push(`[Sheet: ${ws.name}]`);
    let rows = 0;
    ws.eachRow({ includeEmpty: false }, (row) => {
      if (rows++ >= maxRows) return;
      const cells: string[] = [];
      row.eachCell({ includeEmpty: true }, (cell) => {
        const v = cell.value as unknown;
        let t = "";
        if (v == null) t = "";
        else if (typeof v === "object" && v !== null && "result" in v) t = String((v as { result: unknown }).result ?? "");
        else if (typeof v === "object" && v !== null && "richText" in v) t = (v as { richText: { text: string }[] }).richText.map((r) => r.text).join("");
        else if (typeof v === "object" && v !== null && "text" in v) t = String((v as { text: unknown }).text);
        else if (v instanceof Date) t = v.toISOString().slice(0, 10);
        else t = String(v);
        cells.push(t.trim());
      });
      while (cells.length && !cells[cells.length - 1]) cells.pop();
      if (cells.some(Boolean)) out.push(cells.join(" | "));
    });
  });
  return out.join("\n");
}

/** The words in a .docx (paragraphs and table cells). */
export async function wordText(bytes: Uint8Array): Promise<string> {
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(bytes);
  const xml = await zip.file("word/document.xml")?.async("string");
  if (!xml) return "";
  return xml
    .replace(/<w:tab\/>/g, "\t")
    .replace(/<\/w:p>/g, "\n")
    .replace(/<\/w:tc>/g, " | ")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** Best-effort text for one file. Null text with a note when it can't be read. */
export async function readFile(name: string, mime: string | null, bytes: Uint8Array): Promise<{ kind: ReadKind; text: string | null; note: string | null }> {
  const kind = kindOf(name, mime);
  try {
    if (kind === "pdf") {
      const t = await pdfText(bytes);
      return t.length > 20 ? { kind, text: t, note: null } : { kind, text: null, note: "scanned PDF with no text in it: check this one by eye" };
    }
    if (kind === "sheet") return { kind, text: await sheetText(bytes, name), note: null };
    if (kind === "word") return { kind, text: await wordText(bytes), note: null };
    if (kind === "text") return { kind, text: new TextDecoder().decode(bytes), note: null };
    if (kind === "image") return { kind, text: null, note: null };
    return { kind, text: null, note: name.toLowerCase().endsWith(".xls") ? "old .xls spreadsheet: save it as .xlsx to have it read" : "file type that can't be read: check it by eye" };
  } catch {
    return { kind, text: null, note: "couldn't be opened: check it by eye" };
  }
}
