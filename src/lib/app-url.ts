/** The app's public address, for links in emails and PDFs. */
export const appUrl = () => (process.env.NEXT_PUBLIC_SITE_URL || "https://quoteout.app").replace(/\/+$/, "");
