import JSZip from "jszip";
import { NextResponse } from "next/server";
import { ownQuote } from "@/lib/quote-access";
import type { Overview } from "@/lib/rfq/overview";
import { PACK_FOLDERS, areasKml, overviewText, packName } from "@/lib/rfq/pack";
import { quoteWorkbook } from "@/lib/sheet/export";

export const maxDuration = 60;
const MAX_BYTES = 150 * 1024 * 1024;

/** Everything for one job in one zip, organised in folders. */
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  type Q = { id: string; quote_no: string | null; title: string | null; customer_name: string | null; site_address: string | null; job_id: string | null; overview: Overview | null };
  const got = await ownQuote<Q>(id, "id, quote_no, title, customer_name, site_address, job_id, overview");
  if (!got) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const { ctx, db, quote: q } = got;
  const title = q.title || "Quote";
  const root = packName([q.quote_no, title].filter(Boolean).join(" "));
  const zip = new JSZip();
  const top = zip.folder(root)!;
  let total = 0;
  const skipped: string[] = [];

  if (q.job_id) {
    for (const folder of PACK_FOLDERS) {
      const prefix = `${ctx.tenant.id}/${q.job_id}/${folder}`;
      const { data: list } = await db.storage.from("job-files").list(prefix, { limit: 200 });
      for (const f of (list ?? []).filter((x) => x.name && !x.name.startsWith(".") && x.id)) {
        const size = Number((f.metadata as { size?: number } | null)?.size ?? 0);
        if (total + size > MAX_BYTES) { skipped.push(`${folder}/${f.name}`); continue; }
        const { data } = await db.storage.from("job-files").download(`${prefix}/${f.name}`);
        if (!data) { skipped.push(`${folder}/${f.name}`); continue; }
        total += data.size;
        top.folder(folder)!.file(packName(f.name, 180), await data.arrayBuffer());
      }
    }
  }

  const wb = await quoteWorkbook(db, ctx.tenant.id, q.id, ctx.email).catch(() => null);
  if (wb) top.folder("5. Pricing")!.file(packName(wb.filename, 180), wb.bytes);
  top.file("Job overview.txt", overviewText({ title, quoteNo: q.quote_no, customer: q.customer_name, address: q.site_address }, q.overview));
  if (q.overview?.areas?.length) top.file("Measured areas.kml", areasKml(title, q.overview.areas));
  if (skipped.length) top.file("Not included.txt", `These files were too big for one download. Get them from the quote page:\n${skipped.map((s) => `  - ${s}`).join("\n")}\n`);

  const bytes = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE", compressionOptions: { level: 6 } });
  return new NextResponse(Buffer.from(bytes), {
    headers: { "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="${root.replace(/[^\w.\- ()]+/g, "_")}.zip"`, "Cache-Control": "private, no-store" },
  });
}
