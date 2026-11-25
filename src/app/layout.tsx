import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "QUOTES",
  description: "RFQ triage and quote drafting for asphalt and civil contractors",
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
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Space+Grotesk:wght@500;600&display=swap"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
