import type { Metadata, Viewport } from "next";
import "./globals.css";
import { SiteTracker } from "./tracker";

export const metadata: Metadata = {
  title: "quoteout",
  description: "RFQ triage and quote drafting for asphalt and civil contractors",
  appleWebApp: { capable: true, title: "quoteout", statusBarStyle: "black-translucent" },
  icons: { icon: [{ url: "/icon.svg", type: "image/svg+xml" }, { url: "/icon-192.png", sizes: "192x192" }], apple: "/apple-touch-icon.png" },
};

export const viewport: Viewport = {
  themeColor: "#16181B",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-AU">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Space+Grotesk:wght@500;600;700&display=swap"
        />
      </head>
      <body>{children}<SiteTracker /></body>
    </html>
  );
}
