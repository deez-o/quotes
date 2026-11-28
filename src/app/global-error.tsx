"use client";

import { useEffect } from "react";
import { reportError } from "./report-error";

export default function GlobalError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => { reportError(error); }, [error]);
  return (
    <html lang="en-AU">
      <body style={{ fontFamily: "Arial, Helvetica, sans-serif", background: "#f5f6f7", color: "#1c1f23", margin: 0, padding: 24 }}>
        <title>Something went wrong</title>
        <div style={{ maxWidth: 560, margin: "10vh auto", background: "#fff", border: "1px solid #e1e4e8", borderRadius: 10, padding: 24 }}>
          <h1 style={{ marginTop: 0, fontSize: 22 }}>Something went wrong</h1>
          <p>quoteout hit a problem. We&apos;ve been told about it automatically.</p>
          <button type="button" onClick={() => retry()} style={{ font: "inherit", padding: "10px 16px", borderRadius: 8, border: 0, background: "#16181B", color: "#fff", cursor: "pointer" }}>Try again</button>
        </div>
      </body>
    </html>
  );
}
