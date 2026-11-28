"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

/**
 * Pages whose forms save and come back to the same page (costs, setup): stay where you were
 * instead of jumping to the top. Saves the scroll position when a form is sent, puts it back after.
 */
export function KeepScroll() {
  const params = useSearchParams();
  useEffect(() => {
    const save = () => { try { sessionStorage.setItem(`scroll:${location.pathname}`, String(window.scrollY)); } catch { /* private mode */ } };
    document.addEventListener("submit", save, true);
    return () => document.removeEventListener("submit", save, true);
  }, []);
  useEffect(() => {
    let y: string | null = null;
    try { y = sessionStorage.getItem(`scroll:${location.pathname}`); sessionStorage.removeItem(`scroll:${location.pathname}`); } catch { /* ignore */ }
    if (y) requestAnimationFrame(() => window.scrollTo(0, Number(y)));
  }, [params]);
  return null;
}

/** A saved/error message that shows wherever you are on the page. */
export function Toast({ text, ok }: { text: string; ok: boolean }) {
  const [shown, setShown] = useState(true);
  useEffect(() => { const t = setTimeout(() => setShown(false), ok ? 3500 : 8000); return () => clearTimeout(t); }, [ok]);
  if (!shown) return null;
  return (
    <p role={ok ? "status" : "alert"} style={{
      position: "fixed", left: "50%", bottom: 16, transform: "translateX(-50%)", zIndex: 50, margin: 0,
      maxWidth: "calc(100vw - 32px)", padding: "10px 16px", borderRadius: 10, fontWeight: 600, fontSize: 14,
      cursor: "pointer", background: ok ? "#0f5132" : "#842029", color: "#fff", boxShadow: "0 4px 16px rgba(0,0,0,0.18)",
    }} onClick={() => setShown(false)}>{text}</p>
  );
}
