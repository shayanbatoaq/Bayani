import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingExcludes: {
    "/*": ["./.data/**/*", "./.local/**/*"],
  },
  serverExternalPackages: ["pdfjs-dist"],
  turbopack: {
    root: __dirname,
  },
};

export default nextConfig;
