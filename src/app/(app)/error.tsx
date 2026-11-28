"use client";

import Link from "next/link";
import { useEffect } from "react";
import { reportError } from "../report-error";

export default function AppError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => { reportError(error); }, [error]);
  return (
    <div className="page" style={{ maxWidth: 640 }}>
      <section className="card" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <h1 style={{ margin: 0 }}>Something went wrong</h1>
        <p style={{ margin: 0 }}>This page hit a problem. We&apos;ve been told about it automatically. Your saved work is safe.</p>
        <div className="row" style={{ gap: 8 }}>
          <button type="button" className="btn primary" onClick={() => retry()}>Try again</button>
          <Link href="/quotes" className="btn">Back to quotes</Link>
          <Link href="/help" className="btn">Get help</Link>
        </div>
      </section>
    </div>
  );
}
