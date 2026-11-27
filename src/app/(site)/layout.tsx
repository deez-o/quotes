import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "../logo";
import { PHOTOS } from "./photos";
import "./site.css";

// Until launch the site stays out of search engines. Set SITE_LIVE=1 in Vercel to let it be found.
const live = process.env.SITE_LIVE === "1";

export const metadata: Metadata = {
  title: "quoteout: priced asphalt quotes from your RFQs",
  description: "Forward an RFQ and get back a priced asphalt quote, worked out from your own rates, plants, trucks and crews. Check it, then send it from PDF or Xero.",
  robots: live ? { index: true, follow: true } : { index: false, follow: false },
  openGraph: {
    title: "quoteout",
    description: "RFQs in, priced asphalt quotes out. Built for Australian asphalt contractors.",
    images: [PHOTOS.hero.src],
  },
};

export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="w">
      <header className="w-top">
        <div className="w-wrap">
          <Link href="/" aria-label="quoteout home"><Logo size={24} dark /></Link>
          <nav aria-label="Website">
            <Link href="/#how">How it works</Link>
            <Link href="/#pricing">Pricing</Link>
            <Link href="/#questions">Questions</Link>
          </nav>
          <div className="w-right">
            <Link href="/login" className="w-signin">Sign in</Link>
            <Link href="/signup" className="w-btn hi">Start free trial</Link>
          </div>
        </div>
      </header>
      {children}
      <footer className="w-foot">
        <div className="w-wrap">
          <Logo size={20} dark />
          <span>Quoting for Australian asphalt contractors</span>
          <span className="w-right" style={{ display: "flex", gap: 20 }}>
            <Link href="/privacy">Privacy</Link>
            <Link href="/terms">Terms</Link>
            <Link href="/login">Sign in</Link>
          </span>
        </div>
      </footer>
    </div>
  );
}
