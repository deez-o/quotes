import { NextResponse } from "next/server";

/** A filled workbook as a download, keeping .xlsm when the sheet has macros. */
export function xlsxResponse(bytes: Uint8Array, filename: string) {
  const macro = /\.xlsm$/i.test(filename);
  const safe = filename.replace(/[^\w.\- ()]+/g, "_").slice(0, 150) || "quote.xlsx";
  return new NextResponse(Buffer.from(bytes), {
    headers: {
      "Content-Type": macro ? "application/vnd.ms-excel.sheet.macroEnabled.12" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${safe}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
