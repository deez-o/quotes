import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Every page reads the signed-in user's data, so pages render per request.
  cacheComponents: false,
  // Website photography (made with Higgsfield), resized and cached by Vercel.
  images: {
    remotePatterns: [new URL("https://d8j0ntlcm91z4.cloudfront.net/user_3Lc5qmkQ1I8XkazcurCKtrMZA5r/**")],
  },
};

export default nextConfig;
