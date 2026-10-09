import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  distDir: process.env.SETSUNA_DIST_DIR || ".next",
  trailingSlash: true,
  poweredByHeader: false,
  devIndicators: false,
  turbopack: { root: process.cwd() },
};

export default nextConfig;
