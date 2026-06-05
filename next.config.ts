import type { NextConfig } from "next";

const isProd = process.env.NODE_ENV === "production";

// Content-Security-Policy (pragmatic, no-nonce). Keeps static rendering — no
// perf cost — while locking the high-value surfaces: clickjacking
// (frame-ancestors), form-hijack (form-action), <base> injection (base-uri),
// plugins (object-src), and external script/style injection (default/script/
// style-src). Scripts/styles keep 'unsafe-inline' because the App Router
// injects inline hydration scripts and framer-motion applies inline styles; a
// strict (nonce) policy would force all-dynamic rendering. There is no inline-
// script XSS vector in the app today, so this is the right trade.
//   - img-src / media-src allow the Spotify + Apple CDNs (artist art + audio
//     previews played via new Audio()). 'self' covers next/image-optimized URLs.
//   - connect-src is 'self' (all third-party calls happen server-side); dev adds
//     ws: for the Turbopack/HMR socket.
//   - 'unsafe-eval' is dev-only (React uses eval for richer error overlays).
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isProd ? "" : " 'unsafe-eval'"}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://*.scdn.co https://*.mzstatic.com",
  "media-src 'self' https://*.scdn.co https://*.mzstatic.com https://audio-ssl.itunes.apple.com",
  "font-src 'self'",
  `connect-src 'self'${isProd ? "" : " ws: wss:"}`,
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  ...(isProd ? ["upgrade-insecure-requests"] : []),
].join("; ");

// Defense-in-depth headers applied to every route. These don't replace
// application-level checks (auth, CSRF, RLS) — they just close browser-level
// attack surfaces so that a single app bug doesn't become a clickjack,
// mixed-content, or referrer-leak.
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  { key: "Content-Security-Policy", value: csp },
  // HSTS only in production — locally it would block http://localhost.
  ...(isProd
    ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" }]
    : []),
];

const nextConfig: NextConfig = {
  productionBrowserSourceMaps: false,
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "i.scdn.co" },
      { protocol: "https", hostname: "mosaic.scdn.co" },
      { protocol: "https", hostname: "*.mzstatic.com" },
    ],
  },
  experimental: {
    optimizePackageImports: ["lucide-react", "framer-motion", "sonner"],
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
