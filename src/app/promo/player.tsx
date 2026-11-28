"use client";

import { useRef, useState } from "react";

/** Full-screen promo video. Phones only autoplay muted, so: play muted, one tap for sound from the start. */
export function PromoPlayer() {
  const v = useRef<HTMLVideoElement>(null);
  const [sound, setSound] = useState(false);
  const turnOnSound = () => {
    const el = v.current;
    if (!el) return;
    el.muted = false;
    el.currentTime = 0;
    void el.play();
    setSound(true);
  };
  return (
    <div style={{ position: "fixed", inset: 0, background: "#000", display: "grid", placeItems: "center" }}>
      <video
        ref={v} src="/promo/quoteout-promo.mp4" poster="/promo/poster.jpg"
        autoPlay muted playsInline loop={false} controls={sound} preload="auto"
        style={{ width: "100%", height: "100%", objectFit: "contain", background: "#000" }}
        onClick={sound ? undefined : turnOnSound}
      />
      {!sound && (
        <button type="button" onClick={turnOnSound}
          style={{ position: "absolute", bottom: "max(28px, env(safe-area-inset-bottom))", left: "50%", transform: "translateX(-50%)",
            background: "#FF6A13", color: "#16181B", border: 0, borderRadius: 999, padding: "14px 26px", fontWeight: 800, fontSize: 18,
            boxShadow: "0 10px 30px rgba(0,0,0,.5)", cursor: "pointer" }}>
          🔊 Tap for sound
        </button>
      )}
    </div>
  );
}
