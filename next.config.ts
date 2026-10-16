import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  distDir: process.env.SETSUNA_DIST_DIR || ".next",
  trailingSlash: true,
  poweredByHeader: false,
  devIndicators: false,
  turbopack: { root: process.cwd() },
  // One public origin for search: the www host and the project's production
  // vercel.app alias serve the same site, so send them to setsuna.finance.
  // Per-deployment preview URLs are left alone.
  async redirects() {
    // Keep the trailing slash the site uses, so each redirect is a single hop.
    return ["www.setsuna.finance", "setsuna-metropolis.vercel.app"].flatMap((host) => {
      const has = [{ type: "host" as const, value: host }];
      return [
        { source: "/", has, destination: "https://setsuna.finance/", permanent: true },
        { source: "/:path+", has, destination: "https://setsuna.finance/:path+/", permanent: true },
      ];
    });
  },
};

export default nextConfig;
