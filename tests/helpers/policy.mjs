// The request policy adapter (src/lib/security/policy.ts) for tests that load a route through the vm harness.
// A route is `export const POST = route('operation.id', ...)`, so loading it needs the adapter. This loads the
// REAL adapter with the same stubs the test hands the route (session, limiter, account policy ...), plus
// permissive defaults for the functions the test does not care about.
import { loadModule } from './load-ts.mjs';

const DEFAULTS = {
  '@/lib/security/rate-limit': { enforceActionLimit: async () => null, enforceAnonymousLimit: async () => null, enforceGlobalBudget: async () => null },
  '@/lib/security/marketplace-policy': { accountWriteDenied: async () => null },
  '@/lib/membership/access': { requireMarketplaceAccess: async () => null },
  '@/lib/security/human-check': { humanCheckEnabled: () => false, verifyHumanCheck: async () => null },
};

export function loadPolicy(stubs = {}, env) {
  const merged = { ...stubs };
  for (const [name, defaults] of Object.entries(DEFAULTS)) merged[name] = { ...defaults, ...stubs[name] };
  return loadModule('src/lib/security/policy.ts', { ...(env ? { env } : {}), stubs: merged });
}
