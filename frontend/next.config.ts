import type { NextConfig } from "next";

// Same-origin default: the client bundle calls /api on whatever host served the
// page, and nginx proxies /api → the API. Works for any deployment domain with
// no hostname baked into the build. (This repo is always fronted by nginx, so
// no Next-level API rewrite is needed.)
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "/api";

const nextConfig: NextConfig = {
  output: "standalone",
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "images.unsplash.com",
        pathname: "/**",
      },
    ],
  },
  env: {
    NEXT_PUBLIC_API_URL: API_URL,
  },
};

export default nextConfig;
