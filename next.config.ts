import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  // E2E runs `next dev` in its own dir so it never overwrites the production build headers.test.ts inspects.
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
};

export default nextConfig;
