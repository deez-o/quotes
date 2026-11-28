/** Send an error from the browser to quoteout (best effort). */
export function reportError(error: unknown) {
  const e = error instanceof Error ? error : new Error(String(error));
  const digest = (e as Error & { digest?: string }).digest ?? null;
  try {
    void fetch("/api/errors", {
      method: "POST", headers: { "Content-Type": "application/json" }, keepalive: true,
      body: JSON.stringify({ message: `${e.name}: ${e.message}`, digest, path: window.location.pathname + window.location.search, stack: e.stack }),
    }).catch(() => {});
  } catch {
    // ignore
  }
}
