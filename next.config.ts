import type { NextConfig } from 'next';
const nextConfig: NextConfig = {
  poweredByHeader: false,
  // HSTS for every route. No includeSubDomains or preload: those are irreversible commitments for other hosts.
  async headers() {
    return [{ source: '/:path*', headers: [{ key: 'Strict-Transport-Security', value: 'max-age=31536000' }] }];
  },
};
export default nextConfig;
