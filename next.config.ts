import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: { qualities: [75, 80], formats: ["image/webp"] },
  experimental: { proxyTimeout: 120_000, proxyClientMaxBodySize: "10mb" },
  async rewrites() {
    const backend = (process.env.BACKEND_URL || "http://localhost:3000").replace(/\/$/, "");
    return {
      // OAuth navigation uses redirects rather than the JSON auth proxy.
      beforeFiles: ["start", "callback"].map(action => ({
        source: `/api/auth/google/${action}`,
        destination: `${backend}/api/auth/google/${action}`,
      })),
      // Keep the existing auth route in charge of its httpOnly refresh cookie.
      fallback: [{ source: "/api/:path*", destination: `${backend}/api/:path*` }],
    };
  },
};

export default nextConfig;
