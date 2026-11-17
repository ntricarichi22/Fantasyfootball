import type { NextConfig } from "next";
import { deploymentEnvironment, supabaseProjectRef } from "./src/infrastructure/environment.ts";
import { failoverConfigured } from "./src/infrastructure/failover/config.ts";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Derive the browser boundary from trusted deployment metadata at build time.
  env: {
    NEXT_PUBLIC_APP_ENV: deploymentEnvironment(process.env),
    NEXT_PUBLIC_FAILOVER_ACTIVE: String(failoverConfigured(process.env)),
    CFC_BUILD_SUPABASE_PROJECT_REF: supabaseProjectRef(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "") ?? "",
    CFC_BUILD_CREATED_AT: new Date().toISOString(),
  },
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
