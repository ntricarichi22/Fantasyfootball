import type { NextConfig } from "next";
import { deploymentEnvironment } from "./src/infrastructure/environment.ts";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Derive the browser boundary from trusted deployment metadata at build time.
  env: { NEXT_PUBLIC_APP_ENV: deploymentEnvironment(process.env) },
  async headers() {
    return [{
      source: "/(.*)",
      headers: [
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "X-Frame-Options", value: "DENY" },
        { key: "Content-Security-Policy", value: "frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
      ],
    }, {
      source: "/api/:path*",
      headers: [
        { key: "Cache-Control", value: "private, no-store, max-age=0" },
        { key: "Pragma", value: "no-cache" },
      ],
    }];
  },
};

export default nextConfig;
