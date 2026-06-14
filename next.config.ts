import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // pdf-parse and epub2 are CommonJS libs that should run on the Node runtime,
  // not be bundled into the edge/serverless trace aggressively.
  serverExternalPackages: ["pdf-parse", "epub2"],
};

export default nextConfig;
