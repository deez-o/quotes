import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import { fillWorkbook, parseCell, colName } from "@/lib/sheet/fill";
import { cleanMapping, writesFor, SAMPLE_QUOTE, type SheetMapping } from "@/lib/sheet/map";
import { outline, grid } from "@/lib/sheet/read";

async function template() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Quote");
  ws.getCell("B2").value = "QUOTATION";
  ws.getCell("B4").value = "Customer:";
  ws.getCell("C4").font = { bold: true, color: { argb: "FF0000FF" } };
  ws.getCell("B5").value = "Site:";
  ws.getCell("B6").value = "Quote No:";
  ws.getRow(9).values = [undefined, "Description", "Qty", "Unit", "Rate", "Amount"];
  for (let r = 10; r <= 14; r++) ws.getCell(`F${r}`).value = { formula: `C${r}*E${r}` };
  ws.getCell("E16").value = "Total ex GST";
  ws.getCell("F16").value = { formula: "SUM(F10:F14)" };
  ws.getCell("F16").numFmt = "$#,##0.00";
  wb.addWorksheet("Rates").getCell("A1").value = "internal";
  return new Uint8Array(await wb.xlsx.writeBuffer());
}

const mapping: SheetMapping = {
  sheet: "Quote",
  fields: [{ field: "customer_name", cell: "C4" }, { field: "site_address", cell: "C5" }, { field: "quote_no", cell: "C6" }, { field: "subtotal_ex_gst", cell: "F16" }],
  lines: { first_row: 10, last_row: 14, description_col: "B", quantity_col: "C", unit_col: "D", rate_col: "E", total_col: "F" },
  notes: "",
};

async function reread(bytes: Uint8Array) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.from(bytes) as unknown as ArrayBuffer);
  return wb;
}

describe("cell addresses", () => {
  it("reads and writes column letters", () => {
    expect(parseCell("$AB$12")).toEqual({ col: 28, row: 12 });
    expect(colName(1)).toBe("A");
    expect(colName(27)).toBe("AA");
    expect(() => parseCell("12B")).toThrow();
  });
});

describe("filling the customer's sheet", () => {
  it("writes the quote into the right cells and keeps the sheet's looks and other sheets", async () => {
    const { writes } = writesFor(mapping, SAMPLE_QUOTE);
    const { bytes } = await fillWorkbook(await template(), "Quote", writes);
    const wb = await reread(bytes);
    const ws = wb.getWorksheet("Quote")!;
    expect(ws.getCell("C4").value).toBe("Sample Builders Pty Ltd");
    expect(ws.getCell("C4").font?.bold).toBe(true);
    expect(ws.getCell("C6").value).toBe("Q-SAMPLE");
    expect(ws.getCell("B10").value).toBe("Supply and lay AC10, 40 mm");
    expect(ws.getCell("C10").value).toBe(178);
    expect(ws.getCell("E11").value).toBe(4.2);
    expect(ws.getCell("B13").value).toBe("Establishment");
    expect(ws.getCell("B14").value ?? null).toBeNull(); // a spare line row is left blank
    expect(ws.getCell("F16").value).toBe(47818);
    expect(ws.getCell("F16").numFmt).toBe("$#,##0.00");
    expect(wb.getWorksheet("Rates")!.getCell("A1").value).toBe("internal");
  });

  it("sets the workbook to recalculate on open and drops the stale calculation chain", async () => {
    const zip = await JSZip.loadAsync(await template());
    zip.file("xl/calcChain.xml", '<?xml version="1.0"?><calcChain xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><c r="F10" i="1"/></calcChain>');
    const ct = await zip.file("[Content_Types].xml")!.async("string");
    zip.file("[Content_Types].xml", ct.replace("</Types>", '<Override PartName="/xl/calcChain.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.calcChain+xml"/></Types>'));
    const { bytes } = await fillWorkbook(await zip.generateAsync({ type: "uint8array" }), "Quote", [{ cell: "C4", value: "X" }]);
    const out = await JSZip.loadAsync(bytes);
    expect(out.file("xl/calcChain.xml")).toBeNull();
    expect(await out.file("[Content_Types].xml")!.async("string")).not.toContain("calcChain");
    expect(await out.file("xl/workbook.xml")!.async("string")).toMatch(/fullCalcOnLoad="1"/);
  });

  it("keeps macros (.xlsm) untouched", async () => {
    const zip = await JSZip.loadAsync(await template());
    zip.file("xl/vbaProject.bin", new Uint8Array([1, 2, 3, 4]));
    const { bytes } = await fillWorkbook(await zip.generateAsync({ type: "uint8array" }), "Quote", [{ cell: "C4", value: "X" }]);
    const out = await JSZip.loadAsync(bytes);
    expect(Array.from(await out.file("xl/vbaProject.bin")!.async("uint8array"))).toEqual([1, 2, 3, 4]);
  });

  it("writes into empty rows and columns the sheet doesn't have yet", async () => {
    const { bytes } = await fillWorkbook(await template(), "Quote", [{ cell: "H40", value: "far away" }, { cell: "A1", value: 5 }]);
    const ws = (await reread(bytes)).getWorksheet("Quote")!;
    expect(ws.getCell("H40").value).toBe("far away");
    expect(ws.getCell("A1").value).toBe(5);
  });

  it("rolls extra lines into one when the sheet has too few rows, keeping the total", () => {
    const many = { ...SAMPLE_QUOTE, lines: [...SAMPLE_QUOTE.lines, ...SAMPLE_QUOTE.lines] };
    const { writes, combined } = writesFor(mapping, many);
    expect(combined).toBe(4);
    const lastDesc = writes.find((w) => w.cell === "B14")!.value as string;
    expect(lastDesc).toMatch(/^Other items/);
    const sum = writes.filter((w) => /^F1[0-4]$/.test(w.cell)).reduce((s, w) => s + Number(w.value), 0);
    expect(Math.round(sum)).toBe(Math.round(many.lines.reduce((s, l) => s + l.total, 0)));
  });

  it("refuses a file that isn't a workbook", async () => {
    await expect(fillWorkbook(new Uint8Array([1, 2, 3]), null, [])).rejects.toThrow();
  });
});

describe("reading the sheet for mapping and preview", () => {
  it("shows the AI each filled cell with its address", async () => {
    const o = await outline(await template());
    expect(o.sheets).toEqual(["Quote", "Rates"]);
    expect(o.text).toContain("B4: Customer:");
    expect(o.text).toContain("F16: =SUM(F10:F14)");
  });
  it("gives a grid for the preview", async () => {
    const g = await grid(await template(), "Quote");
    expect(g.rows[3][1]).toBe("Customer:");
    expect(g.cols[0]).toBe("A");
  });
  it("keeps only well-formed mappings", () => {
    const m = cleanMapping({ sheet: "Nope", fields: [{ field: "customer_name", cell: "c4" }, { field: "bogus", cell: "A1" }, { field: "gst", cell: "XX" }], lines: { first_row: 10, last_row: 5, description_col: "b", total_col: "F1" }, notes: "check" }, ["Quote"]);
    expect(m!.sheet).toBe("Quote");
    expect(m!.fields).toEqual([{ field: "customer_name", cell: "C4" }]);
    expect(m!.lines).toMatchObject({ first_row: 10, last_row: 10, description_col: "B", total_col: "" });
  });
});

describe("the standard sheet", () => {
  it("lays out the quote with the company's details, lines and totals that add up", async () => {
    const { defaultWorkbook } = await import("@/lib/sheet/default");
    const bytes = await defaultWorkbook({ name: "Demo Asphalt Co", abn: "12 345 678 901", phone: "07 3000 0000", email: "quotes@demo.test", address: "1 Plant Rd", website: null, color: "#FF6A13", logo: null, gstPercent: 10 }, SAMPLE_QUOTE);
    const ws = (await reread(bytes)).getWorksheet("Quote")!;
    const all: string[] = [];
    ws.eachRow((row) => row.eachCell((c) => all.push(typeof c.value === "object" && c.value && "richText" in c.value ? (c.value as { richText: { text: string }[] }).richText.map((t) => t.text).join("") : String((c.value as { formula?: string })?.formula ? `=${(c.value as { formula: string }).formula}` : c.value))));
    expect(all).toContain("Demo Asphalt Co");
    expect(all).toContain("ABN 12 345 678 901");
    expect(all).toContain("QUOTATION");
    expect(all.some((t) => t.includes("Sample Builders Pty Ltd"))).toBe(true);
    expect(all).toContain("Supply and lay AC10, 40 mm");
    expect(all.some((t) => t.startsWith("=SUM(F"))).toBe(true);
  });
});
