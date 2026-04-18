import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Enable standalone output for Docker — produces a minimal self-contained server
  output: "standalone",
};

export default nextConfig;
