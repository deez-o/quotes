"use client";

import { useActionState } from "react";
import { runTrial, setCompareModels, setLiveModel } from "./actions";

type M = { id: string; label: string; note: string; hasKey: boolean };
type R = { ok: true; message?: string } | { ok: false; message: string } | null;

function Msg({ r }: { r: R }) {
  if (!r) return null;
  return <p role="status" className={r.ok ? "" : "error"} style={r.ok ? { color: "var(--good)", fontWeight: 600, margin: 0 } : { margin: 0 }}>{r.message}</p>;
}

export function LiveModelForm({ models, live }: { models: M[]; live: string }) {
  const [r, act, pending] = useActionState(setLiveModel, null);
  return (
    <form action={act} className="card" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {models.map((m) => (
        <label key={m.id} style={{ display: "flex", gap: 10, alignItems: "flex-start", fontWeight: 400, opacity: m.hasKey ? 1 : 0.55 }}>
          <input type="radio" name="model" value={m.id} defaultChecked={m.id === live} disabled={!m.hasKey} style={{ marginTop: 4 }} />
          <span><strong>{m.label}</strong>{m.id === live && <span className="badge good" style={{ marginLeft: 8 }}>In use</span>}
            <span className="sub" style={{ display: "block", marginTop: 2, fontSize: 13 }}>{m.note}{m.hasKey ? "" : " Needs its API key in Vercel."}</span></span>
        </label>
      ))}
      <div className="row" style={{ gap: 12 }}>
        <button className="btn dark" disabled={pending}>{pending ? "Saving..." : "Use this model"}</button>
        <Msg r={r} />
      </div>
    </form>
  );
}

export function TrialForm({ models, jobs }: { models: M[]; jobs: { value: string; label: string }[] }) {
  const [r, act, pending] = useActionState(runTrial, null);
  return (
    <form action={act} className="card" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13 }}>RFQ to test
        <select name="job" required style={{ font: "inherit", border: "1px solid #b6bcc4", borderRadius: 8, padding: 11, background: "#fff" }}>
          {jobs.length === 0 && <option value="">No RFQs yet: forward or import one first</option>}
          {jobs.map((j) => <option key={j.value} value={j.value}>{j.label}</option>)}
        </select>
      </label>
      <fieldset style={{ border: 0, padding: 0, margin: 0, display: "flex", flexWrap: "wrap", gap: 14 }}>
        <legend style={{ fontSize: 13, marginBottom: 6 }}>Models to compare</legend>
        {models.map((m) => (
          <label key={m.id} style={{ display: "flex", gap: 6, alignItems: "center", fontWeight: 400, opacity: m.hasKey ? 1 : 0.5 }}>
            <input type="checkbox" name="models" value={m.id} disabled={!m.hasKey} defaultChecked={m.hasKey && ["grok-4.3", "grok-4.7", "claude-sonnet-5-5"].includes(m.id)} />{m.label}
          </label>
        ))}
      </fieldset>
      <div className="row" style={{ gap: 12 }}>
        <button className="btn primary" disabled={pending || jobs.length === 0}>{pending ? "Running (up to a couple of minutes)..." : "Run the test"}</button>
        <span className="sub" style={{ marginTop: 0, fontSize: 13 }}>Doesn&apos;t change the company&apos;s quotes or use their allowance.</span>
        <Msg r={r} />
      </div>
    </form>
  );
}

export function CompareModelsForm({ models, live, picked }: { models: M[]; live: string; picked: string[] }) {
  const [r, act, pending] = useActionState(setCompareModels, null);
  return (
    <form action={act} className="card" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <p className="sub" style={{ margin: 0, fontSize: 13 }}>
        For testing. Every incoming RFQ is drafted by the model in use as normal, and also by the ones ticked here. Open the quote to see a
        Compare models panel (only you see it) and swap in another model&apos;s version if it did better. The extra drafts cost you AI credit
        but don&apos;t count against the customer&apos;s allowance. Untick all to stop.
      </p>
      <fieldset style={{ border: 0, padding: 0, margin: 0, display: "flex", flexWrap: "wrap", gap: 14 }}>
        {models.filter((m) => m.id !== live).map((m) => (
          <label key={m.id} style={{ display: "flex", gap: 6, alignItems: "center", fontWeight: 400, opacity: m.hasKey ? 1 : 0.5 }}>
            <input type="checkbox" name="compare" value={m.id} disabled={!m.hasKey} defaultChecked={picked.includes(m.id)} />{m.label}
          </label>
        ))}
      </fieldset>
      <div className="row" style={{ gap: 12 }}>
        <button className="btn dark" disabled={pending}>{pending ? "Saving..." : "Save"}</button>
        <Msg r={r} />
      </div>
    </form>
  );
}
