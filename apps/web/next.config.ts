import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  transpilePackages: ["@corgi/contracts", "@corgi/ui"],
  poweredByHeader: false,
  reactStrictMode: true,
};

export default nextConfig;
