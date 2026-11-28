"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { addOption, makeRevision, removeOption, setOutcome } from "./group-actions";

export type QuoteBarView = {
  id: string; label: string; status: string; canEdit: boolean;
  options: { id: string; label: string; title: string; total: number | null }[];
  revisions: { id: string; label: string; sentAt: string | null }[];
  newer: { id: string; label: string } | null;
  accepted: { name: string | null; po: string | null; note: string | null; at: string; option: string | null } | null;
  sentAt: string | null;
  /** Why it was lost, or where a win came from when it wasn't accepted online. */
  outcomeNote: string | null;
  xeroNumber: string | null;
};

const money = (n: number | null) => (n == null ? "-" : `$${Math.round(n).toLocaleString("en-AU")}`);
const when = (s: string) => new Date(s).toLocaleDateString("en-AU", { day: "numeric", month: "short" });

/** Above the quote: its options, revisions, and whether the customer has accepted. */
export function QuoteBar({ v }: { v: QuoteBarView }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [marking, setMarking] = useState<null | "won" | "lost">(null);
  const [mName, setMName] = useState("");
  const [mPo, setMPo] = useState("");
  const [mNote, setMNote] = useState("");
  const [mOption, setMOption] = useState(v.id);
  async function run(kind: string, fn: () => Promise<{ ok: true; id: string } | { ok: false; message: string }>) {
    setBusy(kind); setErr(null);
    const r = await fn();
    setBusy(null);
    if (!r.ok) return setErr(r.message);
    router.push(`/site/${r.id}`);
    router.refresh();
  }
  const isOption = v.options.length > 1;
  const current = v.options.find((o) => o.id === v.id);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {v.newer && (
        <div className="card" style={{ background: "var(--warn-bg)", borderColor: "#f0dba5" }}>
          This is an older revision, kept as it was sent. <Link href={`/site/${v.newer.id}`} style={{ fontWeight: 700, textDecoration: "underline" }}>Open {v.newer.label}</Link>
        </div>
      )}
      {v.accepted && (
        <div className="card" style={{ background: "var(--good-bg)", borderColor: "transparent" }}>
          <strong style={{ color: "var(--good)" }}>Accepted{v.accepted.option ? ` (Option ${v.accepted.option})` : ""} by {v.accepted.name ?? "the customer"} on {new Date(v.accepted.at).toLocaleString("en-AU", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}</strong>
          {v.accepted.po && <div>PO number: <strong>{v.accepted.po}</strong></div>}
          {v.accepted.note && <div>Their note: {v.accepted.note}</div>}
        </div>
      )}

      {v.status === "lost" && (
        <div className="card" style={{ background: "#f3f4f6", borderColor: "transparent" }}>
          <strong>Marked lost</strong>{v.outcomeNote ? `: ${v.outcomeNote}` : ""}
        </div>
      )}

      {v.canEdit && !v.newer && (
        <div className="row" style={{ gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          {v.status !== "won" && v.status !== "lost" ? (
            <>
              <span className="sub" style={{ marginTop: 0 }}>Heard back another way (a PO by email, a phone call{v.xeroNumber ? ", accepted in Xero" : ""})?</span>
              <button type="button" className="btn" style={{ padding: "7px 12px" }} onClick={() => setMarking(marking === "won" ? null : "won")}>Mark as won</button>
              <button type="button" className="btn" style={{ padding: "7px 12px" }} onClick={() => setMarking(marking === "lost" ? null : "lost")}>Mark as lost</button>
            </>
          ) : (
            <button type="button" className="btn" style={{ padding: "7px 12px" }} disabled={busy !== null}
              onClick={() => void run("open", () => setOutcome({ id: v.id, outcome: "open" }))}>{busy === "open" ? "Changing..." : `Undo ${v.status}`}</button>
          )}
        </div>
      )}
      {marking && (
        <div className="card" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 8, alignItems: "end" }}>
          {marking === "won" && isOption && (
            <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, fontWeight: 600 }}>Which option
              <select value={mOption} onChange={(e) => setMOption(e.target.value)}>{v.options.map((o) => <option key={o.id} value={o.id}>Option {o.label}</option>)}</select>
            </label>
          )}
          {marking === "won" && <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, fontWeight: 600 }}>Who accepted<input value={mName} onChange={(e) => setMName(e.target.value)} /></label>}
          {marking === "won" && <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, fontWeight: 600 }}>PO number<input value={mPo} onChange={(e) => setMPo(e.target.value)} /></label>}
          <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, fontWeight: 600, gridColumn: marking === "lost" ? "1 / -1" : undefined }}>{marking === "won" ? "Note" : "Why was it lost? (optional, e.g. price, timing, went with another contractor)"}<input value={mNote} onChange={(e) => setMNote(e.target.value)} /></label>
          <div className="row" style={{ gap: 6 }}>
            <button type="button" className="btn primary" disabled={busy !== null} onClick={() => {
              const target = marking === "won" ? mOption : v.id;
              void run("mark", () => setOutcome({ id: target, outcome: marking, name: mName, po: mPo, note: mNote })).then(() => setMarking(null));
            }}>{busy === "mark" ? "Saving..." : marking === "won" ? "Mark as won" : "Mark as lost"}</button>
            <button type="button" className="btn" onClick={() => setMarking(null)}>Cancel</button>
          </div>
        </div>
      )}

      <div className="row" style={{ gap: 6, flexWrap: "wrap", alignItems: "center" }}>
        {isOption && v.options.map((o) => (
          <Link key={o.id} href={`/site/${o.id}`} className="btn" aria-current={o.id === v.id ? "page" : undefined}
            style={{ padding: "7px 12px", ...(o.id === v.id ? { background: "var(--bitumen)", color: "#fff", borderColor: "var(--bitumen)" } : {}) }}>
            Option {o.label} · {money(o.total)}
          </Link>
        ))}
        {v.canEdit && !v.newer && (
          <button type="button" className="btn" style={{ padding: "7px 12px" }} disabled={busy !== null}
            title="Price the same job another way, e.g. a different mix or depth. The customer picks one."
            onClick={() => void run("add", () => addOption({ id: v.id }))}>{busy === "add" ? "Adding..." : isOption ? "+ Another option" : "+ Add an option"}</button>
        )}
        {v.canEdit && isOption && current && current.label !== "A" && !v.sentAt && !v.newer && (
          <button type="button" className="btn" style={{ padding: "7px 12px" }} disabled={busy !== null}
            onClick={() => { if (window.confirm(`Remove Option ${current.label}?`)) void run("remove", () => removeOption({ id: v.id })); }}>
            {busy === "remove" ? "Removing..." : `Remove Option ${current.label}`}
          </button>
        )}
        <span className="grow" />
        {v.revisions.length > 0 && (
          <span className="sub" style={{ marginTop: 0 }}>
            Earlier: {v.revisions.map((r, i) => <span key={r.id}>{i ? ", " : ""}<Link href={`/site/${r.id}`} style={{ textDecoration: "underline" }}>{r.label}</Link>{r.sentAt ? ` (sent ${when(r.sentAt)})` : ""}</span>)}
          </span>
        )}
        {v.canEdit && !v.newer && v.sentAt && (
          <button type="button" className="btn" style={{ padding: "7px 12px" }} disabled={busy !== null}
            title="Keep what was sent, and make a new version to change"
            onClick={() => void run("rev", () => makeRevision({ id: v.id }))}>{busy === "rev" ? "Making..." : "Make a revision"}</button>
        )}
      </div>
      {isOption && <p className="sub" style={{ margin: 0 }}>Each option is priced on its own. The customer gets them all on one PDF and picks one when they accept.</p>}
      {err && <p className="error" role="alert" style={{ margin: 0 }}>{err}</p>}
    </div>
  );
}
