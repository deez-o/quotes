import type { MetadataRoute } from "next";

/** Lets contractors add quoteout to their phone's home screen and open it like an app. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "quoteout",
    short_name: "quoteout",
    description: "Talk about a job on site and get a priced quote from your own costs.",
    start_url: "/site/new",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#F6F5F2",
    theme_color: "#1C1F23",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
