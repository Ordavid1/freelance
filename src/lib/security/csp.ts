// Runtime policy: Firebase Google auth and Nango keep their existing boundaries.
// Inline styles remain supported; executable scripts require a fresh nonce.
export function contentSecurityPolicy(nonce: string, development = false) {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${development ? " 'unsafe-eval'" : ''}`,
    "script-src-attr 'none'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self'",
    "connect-src 'self' https://identitytoolkit.googleapis.com https://securetoken.googleapis.com https://www.googleapis.com https://api.nango.dev https://www.google-analytics.com https://*.google-analytics.com https://analytics.google.com https://www.googletagmanager.com wss://api.nango.dev",
    "frame-src https://freelance-514118.firebaseapp.com https://connect.nango.dev",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ');
}
