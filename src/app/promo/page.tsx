import type { Metadata } from "next";
import { PromoPlayer } from "./player";

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
  return <PromoPlayer />;
}
