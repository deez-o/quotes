"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { rereadRfqs } from "./actions";

/** "Read again with your costs" for RFQs drafted before the costs were set up. */
export function RereadButton({ siteQuoteId, label, primary = true }: { siteQuoteId?: string; label: string; primary?: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <span className="row" style={{ gap: 8, alignItems: "center", flexWrap: "wrap" }}>
      <button type="button" className={`btn${primary ? " primary" : ""}`} disabled={pending} onClick={() => start(async () => {
        const r = await rereadRfqs(siteQuoteId ? { siteQuoteId } : {});
        if (!r.ok) return setMsg({ ok: false, text: r.message });
        setMsg({ ok: true, text: r.count ? `Reading ${r.count === 1 ? "it" : `${r.count} RFQs`} again. This takes a minute or two; they'll show as Ready for review.` : "Nothing to read again." });
        router.refresh();
      })}>{pending ? "Starting..." : label}</button>
      {msg && <span className={msg.ok ? "sub" : "error"} role="status" style={{ marginTop: 0 }}>{msg.text}</span>}
    </span>
  );
}
