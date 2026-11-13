import type { NextConfig } from 'next';
const nextConfig: NextConfig = {
  poweredByHeader: false,
  // HSTS for every route. No includeSubDomains or preload: those are irreversible commitments for other hosts.
  async headers() {
    return [
      // /__/auth/* (Firebase sign-in helpers, see src/proxy.ts) sets its own framing policy: its iframe is embedded by this site.
      { source: '/((?!__/auth/).*)', headers: [
        { key: 'Strict-Transport-Security', value: 'max-age=31536000' },
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'X-Frame-Options', value: 'DENY' },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        // Compatible with prerendered Next.js scripts and the OAuth popups.
        // A nonce-based script policy needs separate integration testing.
        { key: 'Content-Security-Policy', value: "frame-ancestors 'none'; object-src 'none'; base-uri 'self'" },
      ] },
      { source: '/api/:path*', headers: [{ key: 'Cache-Control', value: 'private, no-store' }] },
    ];
  },
};
export default nextConfig;
