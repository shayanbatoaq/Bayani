import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingExcludes: {
    "/*": ["./.data/**/*", "./.local/**/*"],
  },
  turbopack: {
    root: __dirname,
  },
};

export default nextConfig;
