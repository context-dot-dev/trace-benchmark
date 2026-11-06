import path from "node:path";
import type { NextConfig } from "next";
import { withWorkflow } from "workflow/next";
import { serverEnv } from "./src/lib/env.server";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.2.2"],
  devIndicators: false,
  async rewrites() {
    return {
      beforeFiles: serverEnv.benchmarkDataOrigin
        ? [{
            source: "/api/:endpoint(benchmark|report|download)",
            destination: `${serverEnv.benchmarkDataOrigin}/api/:endpoint`,
          }]
        : [],
    };
  },
  turbopack: {
    root: path.resolve(__dirname),
  },
};

export default withWorkflow(nextConfig);
