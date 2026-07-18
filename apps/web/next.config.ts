import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1"],
  poweredByHeader: false,
  reactStrictMode: true,
  headers() {
    return Promise.resolve([
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          {
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin",
          },
          {
            key: "Permissions-Policy",
            value:
              "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
          },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
        ],
      },
    ]);
  },
  transpilePackages: [
    "@inspection/recipient-access",
    "@inspection/reporting",
    "@inspection/security",
    "@inspection/test-fixtures",
    "@inspection/theme",
  ],
  turbopack: {
    root: path.resolve(import.meta.dirname, "../.."),
  },
  webpack(config: { resolve: { extensionAlias?: Record<string, string[]> } }) {
    // Workspace packages are authored with NodeNext-compatible `.js` import
    // specifiers and consumed from TypeScript source during local web work.
    // Teach webpack to resolve those emitted specifiers back to their source
    // files without weakening the packages' runtime ESM contract.
    config.resolve.extensionAlias = {
      ".js": [".ts", ".tsx", ".js"],
      ".jsx": [".tsx", ".jsx"],
    };
    return config;
  },
};

export default nextConfig;
