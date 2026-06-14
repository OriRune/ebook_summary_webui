import type { NextConfig } from "next";

// Conservative CSP. The browser only ever talks to our own origin — all LLM and
// provider traffic happens server-side in API routes — so connect-src can stay
// 'self'. 'unsafe-inline'/'unsafe-eval' are required for Next's runtime; tighten
// with nonces later if desired.
const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
  "form-action 'self'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const nextConfig: NextConfig = {
  // pdf-parse and epub2 are CommonJS libs that should run on the Node runtime,
  // not be bundled into the edge/serverless trace aggressively.
  serverExternalPackages: ["pdf-parse", "epub2"],

  // Guarantee pdf-parse's bundled pdf.js engine (deep-required in src/lib/parser/pdf.ts)
  // is included in the /api/parse serverless function on Vercel.
  outputFileTracingIncludes: {
    "/api/parse": ["./node_modules/pdf-parse/lib/**"],
  },

  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
};

export default nextConfig;
