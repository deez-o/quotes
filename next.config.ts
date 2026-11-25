import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Every page reads the signed-in user's data, so pages render per request.
  cacheComponents: false,
};

export default nextConfig;
