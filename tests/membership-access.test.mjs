import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { Timestamp } from 'firebase-admin/firestore';
registerHooks({ resolve(specifier, context, next) {
  if (specifier === 'server-only') return { url: 'data:text/javascript,export{}', shortCircuit: true };
  if (specifier.startsWith('@/')) return next(new URL('../src/' + specifier.slice(2) + '.ts', import.meta.url).href, context);
  if (specifier === 'next/server') return next(specifier + '.js', context);
  if (specifier === './state') return next('./state.ts', context);
  return next(specifier, context);
} });
let membership;
await mock.module('../src/lib/db/firestore.ts', { namedExports: { firestore: () => ({ collection: name => ({ doc: () => ({ get: async () => ({ exists: true, data: () => name === 'profiles' ? { profileType: 'publisher' } : membership }) }) }) }) } });
await mock.module('../src/lib/auth/firebase-admin.ts', { namedExports: { adminAuth: () => ({}) } });
const { getMembershipAccess, requireMarketplaceAccess } = await import('../src/lib/membership/access.ts');
test('account membership applies in both views without a saved publisher restriction', async () => {
  membership = { state: 'legacy' };
  assert.equal((await getMembershipAccess('user')).canUseMarketplace, true);
  assert.equal(await requireMarketplaceAccess('user'), null);
  membership = { state: 'trial', trialStartedAt: Timestamp.fromMillis(Date.now() - 1000), trialEndsAt: Timestamp.fromMillis(Date.now() + 60000) };
  assert.equal((await getMembershipAccess('user')).canUseMarketplace, true);
  membership = { state: 'trial', trialStartedAt: Timestamp.fromMillis(1000), trialEndsAt: Timestamp.fromMillis(2000) };
  assert.equal((await requireMarketplaceAccess('user')).status, 402);
});
