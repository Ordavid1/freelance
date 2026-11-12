// Runtime policy: Firebase Google auth and Nango keep their existing boundaries.
// Inline styles remain supported; executable scripts require a fresh nonce.
export function contentSecurityPolicy(nonce: string, development = false, authDomain = '') {
  // The Firebase auth iframe is same-origin when FIREBASE_AUTH_DOMAIN is the site's own host (served through
  // /__/auth/*, see proxy.ts); otherwise the configured Firebase-hosted domain must be allowed explicitly.
  const authFrame = /^[a-z0-9.-]+$/i.test(authDomain) ? ` https://${authDomain}` : '';
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${development ? " 'unsafe-eval'" : ''}`,
    "script-src-attr 'none'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self'",
    "connect-src 'self' https://identitytoolkit.googleapis.com https://securetoken.googleapis.com https://www.googleapis.com https://api.nango.dev https://www.google-analytics.com https://*.google-analytics.com https://analytics.google.com https://www.googletagmanager.com wss://api.nango.dev",
    `frame-src 'self'${authFrame} https://connect.nango.dev`,
    "frame-ancestors 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ');
}
