import path from "node:path";
import type { NextConfig } from "next";

import { TRACE_ORIGIN } from "./src/lib/trace/origin";

// The benchmark's collector keeps publishing at TRACE_ORIGIN. Its live summary, paged results and downloads are
// proxied under the same paths the original page used, so every download link and API call stays same-origin.
const PROXIED_PATHS = ["/api/:path*", "/data/:path*", "/pricing.json", "/plan.md"];

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  // A package-lock.json in the home directory would otherwise make Turbopack treat $HOME as the workspace root.
  turbopack: {
    root: path.resolve(__dirname),
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async rewrites() {
    return PROXIED_PATHS.map((source) => ({ source, destination: `${TRACE_ORIGIN}${source}` }));
  },
};

export default nextConfig;
