/** The promo video with quoteout branding around it: logo, dark background, framed video. Nothing else. */
import { Logo } from "../logo";

export function PromoPlayer() {
  return (
    <main style={{ minHeight: "100dvh", background: "radial-gradient(900px 700px at 80% 0%, #24272c 0%, #16181B 60%), #16181B",
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 18, padding: "20px 14px 28px" }}>
      <Logo size={36} dark />
      <video
        src="/promo/quoteout-promo.mp4" poster="/promo/poster.jpg" controls playsInline preload="metadata"
        style={{ width: "100%", maxWidth: 440, maxHeight: "calc(100dvh - 110px)", aspectRatio: "9 / 16", borderRadius: 22, background: "#000",
          boxShadow: "0 0 0 2px #2f3237, 0 24px 60px rgba(0,0,0,.55)" }}
      />
    </main>
  );
}
