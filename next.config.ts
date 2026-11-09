import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV !== "production";
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";

// Content-Security-Policy: the browser only talks to this app and to Supabase.
// Google, the bank and the AI provider are only ever called from the server.
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  `connect-src 'self' ${supabaseUrl} ${supabaseUrl.replace(/^http/, "ws")}`.trim(),
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self' https://accounts.google.com",
  "object-src 'none'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  ...(isDev ? [] : [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" }]),
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  experimental: {
    // Bank CSV exports are sent to a server action for parsing (validated to ≤5 MB there).
    serverActions: { bodySizeLimit: "6mb" },
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

/**
 * GitHub Pages edition (NEXT_PUBLIC_LOCAL_MODE=1): a static export that runs
 * entirely in the browser. Only *.local.tsx route files are used, and
 * tsconfig.local.json swaps server modules (database client, server actions,
 * credential crypto) for browser versions backed by on-device storage.
 */
const pagesConfig: NextConfig = {
  output: "export",
  distDir: "out", // static site output; also keeps the server edition's .next (and its route types) untouched
  basePath: process.env.NEXT_PUBLIC_BASE_PATH || undefined,
  trailingSlash: true,
  images: { unoptimized: true },
  pageExtensions: ["local.tsx", "local.ts"],
  poweredByHeader: false,
  // The server edition is type-checked with the main tsconfig (npm run typecheck).
  typescript: { tsconfigPath: "tsconfig.local.json", ignoreBuildErrors: true },
  turbopack: nextConfig.turbopack,
};

export default process.env.NEXT_PUBLIC_LOCAL_MODE === "1" ? pagesConfig : nextConfig;
