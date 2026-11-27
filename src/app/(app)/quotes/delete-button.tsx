"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteQuote } from "./actions";

/** Two taps to delete: the first asks, the second deletes. */
export function DeleteQuote({ kind, id, label }: { kind: "site" | "rfq"; id: string; label: string }) {
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  if (!asking) {
    return (
      <button type="button" className="btn" aria-label={`Delete ${label}`} onClick={() => setAsking(true)}
        style={{ padding: "7px 12px", color: "#9a3412", borderColor: "#f0b8a8", background: "#fdf1ed" }}>Delete</button>
    );
  }
  return (
    <span className="row" style={{ gap: 6, flexWrap: "nowrap" }}>
      <button type="button" className="btn" disabled={pending} style={{ padding: "7px 12px", background: "#b42318", borderColor: "#b42318", color: "#fff" }}
        onClick={() => start(async () => {
          const r = await deleteQuote({ kind, id });
          if (!r.ok) { setError(r.message ?? "Couldn't delete."); return; }
          router.refresh();
        })}>
        {pending ? "Deleting..." : "Delete for good"}
      </button>
      <button type="button" className="btn" style={{ padding: "7px 12px" }} onClick={() => { setAsking(false); setError(null); }}>Keep</button>
      {error && <span className="error" style={{ fontSize: 12 }}>{error}</span>}
    </span>
  );
}
