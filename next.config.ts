import type { NextConfig } from "next";
const config: NextConfig = {
  poweredByHeader: false,
  serverExternalPackages: ["ffmpeg-static", "ffprobe-static"],
  experimental: { proxyClientMaxBodySize: "110mb" },
};
export default config;
