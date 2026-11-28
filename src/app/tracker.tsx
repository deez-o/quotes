"use client";

import { useEffect } from "react";
import { startTracking, track, type TrackKind } from "@/lib/track";

/** Visit and click tracking for the sales site (see src/lib/track.ts). */
export function SiteTracker() {
  useEffect(() => { startTracking(); }, []);
  return null;
}

/** Sends one event when the page loads, e.g. a purchase on the "payment received" page. */
export function TrackOnce({ kind, details }: { kind: TrackKind; details?: Record<string, string | number | boolean | null> }) {
  useEffect(() => {
    const k = `qoOnce:${kind}:${location.search}`;
    try { if (sessionStorage.getItem(k)) return; sessionStorage.setItem(k, "1"); } catch { /* private mode */ }
    track(kind, details);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per page load
  }, []);
  return null;
}
