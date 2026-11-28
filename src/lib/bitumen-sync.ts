import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { extractText, getDocumentProxy } from "unpdf";
import { TMR_INDEX_URLS, parseTmrIndex } from "./bitumen-tmr";
import { sendEmail } from "@/lib/mail/send";
import { monthName } from "./bitumen";

/** Download TMR's index PDF and add any months we don't have (or that TMR has corrected). */
export async function syncTmrIndex(admin: SupabaseClient): Promise<{ ok: boolean; added: string[]; message: string }> {
  let rows: { month: string; value: number }[] = [];
  let lastErr = "";
  for (const url of TMR_INDEX_URLS) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(30_000), headers: { "User-Agent": "quoteout (bitumen index check)" } });
      if (!r.ok) { lastErr = `TMR answered ${r.status}`; continue; }
      const pdf = await getDocumentProxy(new Uint8Array(await r.arrayBuffer()));
      const { text } = await extractText(pdf, { mergePages: true });
      rows = parseTmrIndex(Array.isArray(text) ? text.join("\n") : text);
      if (rows.length) break;
      lastErr = "No months found in the PDF";
    } catch (e) {
      lastErr = e instanceof Error ? e.message : "download failed";
    }
  }
  if (!rows.length) return { ok: false, added: [], message: `Couldn't read TMR's index: ${lastErr}` };
  const { data: have } = await admin.from("bitumen_indexes").select("month, value");
  const known = new Map((have ?? []).map((h) => [String(h.month).slice(0, 10), Number(h.value)]));
  const changed = rows.filter((r) => known.get(r.month) !== r.value);
  if (changed.length) {
    await admin.from("bitumen_indexes").upsert(changed.map((r) => ({ ...r, source: "TMR Qld bitumen price index (automatic)", updated_at: new Date().toISOString() })));
    const to = (process.env.ALERT_EMAIL ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    if (to.length) {
      const text = `Bitumen index updated from TMR:\n${changed.map((c) => `${monthName(c.month)}: $${c.value}`).join("\n")}`;
      await sendEmail({ fromName: "quoteout", replyTo: null, to, cc: [], subject: "Bitumen index updated", text, html: `<pre style="font-family:Arial,sans-serif">${text}</pre>`, attachments: [] }).catch(() => null);
    }
  }
  return { ok: true, added: changed.map((c) => c.month), message: changed.length ? `Updated ${changed.length} month${changed.length === 1 ? "" : "s"}.` : "Already up to date." };
}
