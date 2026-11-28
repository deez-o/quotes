import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "../logo";

export const dynamic = "force-static";

const TITLE = "quoteout: asphalt quotes out the door in minutes";
const DESC = "Forward the RFQ or talk on site. quoteout reads the plans and prices the job from your own rates. Coming soon.";

// What a link preview shows (iMessage, WhatsApp, Facebook, LinkedIn, X).
export const metadata: Metadata = {
  metadataBase: new URL("https://quoteout.app"),
  title: TITLE,
  description: DESC,
  alternates: { canonical: "/promo" },
  // Like the rest of the site: out of search engines until launch (link previews still work).
  robots: process.env.SITE_LIVE === "1" ? undefined : { index: false, follow: false },
  openGraph: {
    type: "video.other", url: "/promo", siteName: "quoteout", title: TITLE, description: DESC, locale: "en_AU",
    images: [{ url: "/promo/og.jpg", width: 1200, height: 630, alt: "quoteout: asphalt quotes out the door in minutes, not hours" }],
    videos: [{ url: "https://quoteout.app/promo/quoteout-promo.mp4", secureUrl: "https://quoteout.app/promo/quoteout-promo.mp4", type: "video/mp4", width: 1080, height: 1920 }],
  },
  twitter: { card: "summary_large_image", title: TITLE, description: DESC, images: ["/promo/og.jpg"] },
};

export default function Promo() {
  return (
    <main style={{ minHeight: "100dvh", background: "#16181B", color: "#F5F3EE", display: "flex", flexDirection: "column", alignItems: "center", padding: "24px 16px 40px", gap: 20 }}>
      <Link href="/" aria-label="quoteout home"><Logo size={34} dark /></Link>
      <video
        src="/promo/quoteout-promo.mp4" poster="/promo/poster.jpg" controls playsInline preload="metadata"
        style={{ width: "100%", maxWidth: 420, aspectRatio: "9 / 16", borderRadius: 20, background: "#000", boxShadow: "0 24px 60px rgba(0,0,0,.5)" }}
      />
      <div style={{ maxWidth: 420, textAlign: "center", display: "flex", flexDirection: "column", gap: 12 }}>
        <h1 style={{ fontSize: 28, lineHeight: 1.15, margin: 0, fontWeight: 800 }}>Asphalt quotes out the door in minutes, not hours.</h1>
        <p style={{ margin: 0, color: "#B6BCC4", fontSize: 16, lineHeight: 1.5 }}>
          Forward the RFQ or talk on site. quoteout reads the plans, prices the job from your own rates, and sends it from the app or through Xero.
        </p>
        <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap", marginTop: 6 }}>
          <Link href="/" style={{ background: "#FF6A13", color: "#16181B", borderRadius: 999, padding: "12px 22px", fontWeight: 800, textDecoration: "none" }}>See what it does</Link>
          <a href="mailto:hello@quoteout.app?subject=quoteout%20early%20access" style={{ border: "2px solid #3A3D42", color: "#F5F3EE", borderRadius: 999, padding: "10px 20px", fontWeight: 700, textDecoration: "none" }}>Get early access</a>
        </div>
        <p style={{ margin: "8px 0 0", color: "#7A8089", fontSize: 13 }}>Built for Queensland asphalt contractors.</p>
      </div>
    </main>
  );
}
