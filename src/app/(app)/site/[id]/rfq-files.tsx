"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { PortalInvite } from "@/lib/rfq/portal";
import { addRfqFiles, fetchPortalNow, refetchEmails } from "./files-actions";
import Link from "next/link";

const MAX_MB = 50;
const safeName = (n: string) => n.replace(/[\\/:*?"<>|#%{}^~[\]`]+/g, "_").replace(/\s+/g, " ").trim().slice(0, 100) || "file";

/** Tender portal card and "add the documents" for an RFQ quote. */
export type PortalFetch = { ok: boolean | null; at: string; message?: string; note?: string; reason?: string; added?: number } | null;

export function RfqFiles({ quoteId, tenantId, portal, canEdit, fetched, hasLogin, linkCount = 0 }: { quoteId: string; tenantId: string; portal: PortalInvite | null; canEdit: boolean; fetched: PortalFetch; hasLogin: boolean; linkCount?: number }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function upload(list: FileList | File[] | null) {
    const files = Array.from(list ?? []).slice(0, 10);
    if (!files.length) return;
    const big = files.find((f) => f.size > MAX_MB * 1024 * 1024);
    if (big) return setMsg({ ok: false, text: `${big.name} is over ${MAX_MB} MB. Unzip it and add the drawings and specs you need.` });
    setBusy(true); setMsg({ ok: true, text: "Uploading..." });
    try {
      const supabase = createClient();
      const id = crypto.randomUUID();
      const paths: string[] = [];
      for (const [i, f] of files.entries()) {
        const path = `${tenantId}/uploads/rfqfiles-${id}/${i + 1}-${safeName(f.name)}`;
        const { error } = await supabase.storage.from("job-files").upload(path, f, { contentType: f.type || "application/octet-stream" });
        if (error) throw new Error(`${f.name}: ${error.message}`);
        paths.push(path);
      }
      setMsg({ ok: true, text: "Unpacking..." });
      const r = await addRfqFiles({ id: quoteId, paths });
      if (!r.ok) throw new Error(r.message);
      setMsg({ ok: true, text: `Added ${r.added} file${r.added === 1 ? "" : "s"}${r.skipped.length ? ` (skipped ${r.skipped.slice(0, 4).join(", ")}${r.skipped.length > 4 ? "..." : ""})` : ""}. Reading the RFQ again now: refresh in a minute or two.` });
      router.refresh();
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "Upload failed." });
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <section className="card" style={{ display: "flex", flexDirection: "column", gap: 10, ...(portal ? { borderColor: "var(--accent)", borderWidth: 2 } : {}) }}
      onDragOver={(e) => { if (canEdit) { e.preventDefault(); setDrag(true); } }} onDragLeave={() => setDrag(false)}
      onDrop={(e) => { e.preventDefault(); setDrag(false); if (canEdit && !busy) void upload(e.dataTransfer.files); }}>
      {portal ? (
        <>
          <h2 style={{ margin: 0 }}>Tender on {portal.portal}</h2>
          <p style={{ margin: 0 }}>
            {portal.builder ?? "The builder"} invited you to tender{portal.project ? ` on ${portal.project}` : ""}.{portal.due ? <> Due <strong>{portal.due}</strong>.</> : null}
            {" "}The drawings and specs are on {portal.portal}, not in the email.
          </p>
          {(portal.contactName || portal.contactEmail || portal.contactPhone) && (
            <p className="sub" style={{ marginTop: 0 }}>Contact: {[portal.contactName, portal.contactEmail, portal.contactPhone].filter(Boolean).join(" · ")}</p>
          )}
          {fetched?.ok === true && <p style={{ margin: 0, color: "var(--good)", fontWeight: 600 }}>✓ quoteout downloaded {fetched.added ?? 0} document{fetched.added === 1 ? "" : "s"} from {portal.portal} and read them.</p>}
          {fetched?.ok === null && <p style={{ margin: 0, fontWeight: 600 }}>Fetching the documents from {portal.portal}... refresh in a minute or two.</p>}
          {fetched?.ok === false && (
            <p style={{ margin: 0, background: "var(--warn-bg)", padding: "8px 10px", borderRadius: 8 }}>
              Couldn&apos;t download the documents automatically: {fetched.message}{" "}
              {!hasLogin || fetched.reason === "login_needed" || fetched.reason === "login_failed" ? <Link href="/setup#portals" style={{ textDecoration: "underline", fontWeight: 600 }}>Add your {portal.portal} login</Link> : null}
            </p>
          )}
          {canEdit && portal.docsUrl && fetched?.ok !== null && (
            <div><button type="button" className="btn" disabled={busy} onClick={async () => {
              setBusy(true); const r = await fetchPortalNow({ id: quoteId }); setBusy(false);
              setMsg(r.ok ? { ok: true, text: `Fetching from ${portal.portal}. Refresh in a minute or two.` } : { ok: false, text: r.message }); router.refresh();
            }}>{hasLogin ? `Fetch the documents from ${portal.portal} now` : `Try fetching from ${portal.portal}`}</button></div>
          )}
          <p className="sub" style={{ margin: 0 }}>Or by hand:</p>
          <ol style={{ margin: 0, paddingLeft: 20, display: "flex", flexDirection: "column", gap: 4 }}>
            <li>{portal.docsUrl ? <a href={portal.docsUrl} target="_blank" rel="noreferrer" style={{ textDecoration: "underline", fontWeight: 600 }}>Open the documents on {portal.portal}</a> : `Open the invitation on ${portal.portal}`} and download them (the zip is fine).</li>
            <li>Drop them below. quoteout reads them and fills in the quote.</li>
            <li>When it&apos;s ready, submit your price on {portal.portal} (or send it from here).</li>
          </ol>
        </>
      ) : (
        <>
          <h2 style={{ margin: 0 }}>{linkCount ? "Linked documents" : "Add documents"}</h2>
          {linkCount > 0 && fetched?.ok === true && <p style={{ margin: 0, color: "var(--good)", fontWeight: 600 }}>✓ quoteout downloaded {fetched.added ?? 0} document{fetched.added === 1 ? "" : "s"} from the link{linkCount > 1 ? "s" : ""} in the email and read them.</p>}
          {linkCount > 0 && fetched?.ok === null && <p style={{ margin: 0, fontWeight: 600 }}>Downloading the linked documents... refresh in a minute or two.</p>}
          {linkCount > 0 && fetched?.ok === false && (
            <p style={{ margin: 0, background: "var(--warn-bg)", padding: "8px 10px", borderRadius: 8 }}>
              Couldn&apos;t download the linked documents: {fetched.message}{" "}
              {fetched.reason === "reconnect" && <a href="/api/connect/microsoft" style={{ textDecoration: "underline", fontWeight: 600 }}>Reconnect Outlook</a>}
            </p>
          )}
          {linkCount > 0 && canEdit && fetched?.ok !== null && (
            <div><button type="button" className="btn" disabled={busy} onClick={async () => {
              setBusy(true); const r = await fetchPortalNow({ id: quoteId }); setBusy(false);
              setMsg(r.ok ? { ok: true, text: "Downloading. Refresh in a minute or two." } : { ok: false, text: r.message }); router.refresh();
            }}>Download the linked documents now</button></div>
          )}
          <p className="sub" style={{ marginTop: 0 }}>{linkCount ? "Or add them by hand: d" : "D"}rawings, specs or a schedule that didn&apos;t come with the email. quoteout reads them and redoes the draft.</p>
        </>
      )}
      {canEdit && (
        <div style={{ border: `2px dashed ${drag ? "var(--accent)" : "#b6bcc4"}`, borderRadius: 10, padding: 16, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", background: drag ? "var(--accent-soft, #fff4ec)" : undefined }}>
          <input ref={input} type="file" multiple hidden accept=".zip,.pdf,.png,.jpg,.jpeg,.webp,.xlsx,.xlsm,.xls,.csv,.docx" onChange={(e) => void upload(e.target.files)} />
          <button type="button" className="btn primary" disabled={busy} onClick={() => input.current?.click()}>{busy ? "Working..." : "Add the documents"}</button>
          <span className="sub" style={{ marginTop: 0, fontSize: 13 }}>or drop the files or zip here. PDFs, drawings, spreadsheets. Reading again replaces the items on this draft.</span>
        </div>
      )}
      {canEdit && (
        <div className="sub" style={{ marginTop: 0, fontSize: 13 }}>
          Something missing from the email, like a picture of the areas?{" "}
          <button type="button" disabled={busy} style={{ border: 0, background: "none", padding: 0, font: "inherit", fontWeight: 600, color: "var(--ink)", textDecoration: "underline", cursor: "pointer" }}
            onClick={async () => {
              setBusy(true); setMsg({ ok: true, text: "Fetching the email again from your inbox..." });
              const r = await refetchEmails({ id: quoteId }); setBusy(false);
              setMsg(r.ok ? { ok: true, text: `${r.added ? `Picked up ${r.added} more file${r.added === 1 ? "" : "s"}` : "Nothing new in the email"}. In the email: ${r.seen.length ? r.seen.join(", ") : "no attachments or pictures at all (the forward may have dropped them: add them below)"}. Reading the RFQ again now: refresh in a minute or two.` } : { ok: false, text: r.message });
              if (r.ok) router.refresh();
            }}>Fetch the email again</button>
        </div>
      )}
      {msg && <span className={msg.ok ? "sub" : "error"} role="status" style={{ marginTop: 0 }}>{msg.text}</span>}
    </section>
  );
}
