"use client";

import { useEffect } from "react";
import { createClient } from "@/lib/supabase/client";

/**
 * "Keep me signed in" unticked: signs out once the browser has been closed.
 * The qo_alive cookie has no expiry, so the browser drops it on close; the
 * qo_short flag in local storage remembers that this sign-in was meant to be short.
 */
export function SessionGuard() {
  useEffect(() => {
    let short = false;
    try { short = localStorage.getItem("qo_short") === "1"; } catch { return; }
    if (!short || document.cookie.split("; ").some((c) => c === "qo_alive=1")) return;
    try { localStorage.removeItem("qo_short"); } catch {}
    void createClient().auth.signOut().then(() => window.location.replace("/login"));
  }, []);
  return null;
}
