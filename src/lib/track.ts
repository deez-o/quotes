/**
 * Visit and lead tracking for the quoteout sales site, into Soundy Media's shared reports
 * (Supabase "soundy-reports", client "quoteout"). Writes only through the public track() function
 * with the publishable key: it can add an event, never read one. Never send customer data here.
 */
const URL = "https://eqtkbivkyhcdbiwzaegj.supabase.co/rest/v1/rpc/track";
const KEY = "sb_publishable_pTDZMGWXKuWb2tsVEakNVQ_eNB9GuEE";
const CLIENT = "quoteout";

export type TrackKind = "visit" | "cta_click" | "signup" | "demo" | "checkout" | "purchase" | "email" | "call" | "form";

function store(): Record<string, string> {
  try { return (window.sessionStorage as unknown as Record<string, string>) ?? {}; } catch { return {}; }
}

/** UTM tags and the outside referrer from the page they landed on, kept for the session. */
function source(): { utm: Record<string, string>; ref: string } {
  const ss = store();
  const p = new URLSearchParams(location.search);
  let utm: Record<string, string> = {};
  for (const k of ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "fbclid"]) { const v = p.get(k); if (v) utm[k] = v; }
  try { if (Object.keys(utm).length) ss.qoUtm = JSON.stringify(utm); else utm = JSON.parse(ss.qoUtm || "{}"); } catch { /* private mode */ }
  let ref = document.referrer && !document.referrer.includes(location.host) ? document.referrer : "";
  try { if (ref) ss.qoRef = ref; else ref = ss.qoRef || ""; } catch { /* private mode */ }
  return { utm, ref };
}

export function track(kind: TrackKind, details: Record<string, string | number | boolean | null> = {}) {
  if (typeof window === "undefined") return;
  // Not from local development or preview builds.
  if (!/(^|\.)quoteout\.app$/.test(location.hostname)) return;
  try {
    const { utm, ref } = source();
    void fetch(URL, {
      method: "POST", keepalive: true,
      headers: { apikey: KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ p_client: CLIENT, p_kind: kind, p_page: location.pathname + location.hash, p_referrer: ref || null, p_utm: utm, p_details: details }),
    }).catch(() => {});
  } catch { /* never break the page */ }
}

/** Once a session: the visit. Then the clicks that matter: sign up, sign in, email, phone, the demo video. */
export function startTracking() {
  const ss = store();
  try { source(); if (!ss.qoVisit) { ss.qoVisit = "1"; track("visit", { w: innerWidth }); } } catch { /* private mode */ }
  document.addEventListener("click", (e) => {
    const el = (e.target as Element | null)?.closest?.("a,button,[data-track]");
    if (!el) return;
    const href = el.getAttribute("href") ?? "";
    const text = (el.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 60);
    const named = el.getAttribute("data-track");
    if (href.startsWith("mailto:")) track("email", { text });
    else if (href.startsWith("tel:")) track("call", { text });
    else if (named) track("cta_click", { cta: named, text });
    else if (/^\/(signup|login)\b/.test(href) || /quoteout\.app\/(signup|login)/.test(href)) track("cta_click", { to: href.split("?")[0], text });
  }, { capture: true });
  // The promo video started: counts as a demo.
  document.addEventListener("play", (e) => {
    const v = e.target as HTMLVideoElement;
    if (v?.tagName === "VIDEO" && !v.dataset.tracked) { v.dataset.tracked = "1"; track("demo", { video: (v.currentSrc || "").split("/").pop() ?? "" }); }
  }, { capture: true });
}
