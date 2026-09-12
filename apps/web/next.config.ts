import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // 75 is the default; 92 is used for the landing hero painting, which is shown large and must stay crisp.
  images: { qualities: [75, 92] },
  transpilePackages: ["@corgi/contracts", "@corgi/ui"],
  poweredByHeader: false,
  reactStrictMode: true,
};

export default nextConfig;
