import type { MetadataRoute } from "next";

/** Lets contractors add quoteout to their phone's home screen and open it like an app. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "quoteout",
    short_name: "quoteout",
    description: "Your quotes, out the door. Talk through a job or import an RFQ, and get a priced quote from your own costs.",
    start_url: "/site/new",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#16181B",
    theme_color: "#16181B",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
