// Account state is enforced by the policy layer from the operation registry, not by each route remembering to.
// This runs the REAL adapter and the REAL account check over a fake Firestore holding restricted accounts.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { loadModule } from './helpers/load-ts.mjs';
import { loadPolicy } from './helpers/policy.mjs';
import { createFakeFirestore } from './helpers/fake-firestore.mjs';

const ORIGIN = 'https://freelance-place.com';
const { operations } = loadModule('src/lib/security/operations.ts', {
  stubs: { '@/lib/headhunters/messages': { HEADHUNTER_API_ERRORS: { SIGN_IN: 'sign-in', FORBIDDEN: 'forbidden' } } },
});

function adapter(state) {
  const db = createFakeFirestore(state ? { accountSecurity: { 'uid-1': { state } } } : {});
  const marketplace = loadModule('src/lib/security/marketplace-policy.ts', { stubs: {
    'node:crypto': { createHash },
    '@/lib/db/firestore': { firestore: () => db },
  } });
  return loadPolicy({
    '@/lib/auth/session': { getCurrentUser: async () => ({ uid: 'uid-1', email: 'a@example.com', name: 'A', picture: null }), isSameOrigin: () => true, publicAppOrigin: () => ORIGIN },
    '@/lib/security/marketplace-policy': { accountWriteDenied: marketplace.accountWriteDenied },
  }, { NEXT_PUBLIC_SITE_URL: ORIGIN });
}
const request = () => new Request(`${ORIGIN}/api/x`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });

const signedIn = Object.entries(operations).filter(([, operation]) => operation.auth.kind === 'user' || operation.auth.kind === 'optionalUser');
const active = signedIn.filter(([, operation]) => operation.account === 'active').map(([id]) => id);
const any = signedIn.filter(([, operation]) => operation.account === 'any').map(([id]) => id);

test('the registry has account-active operations to protect', () => {
  assert.ok(active.length >= 15);
  assert.ok(any.length >= 15);
});

for (const state of ['restricted', 'suspended']) {
  test(`a ${state} account is denied by every account-active operation before its handler or budgets run`, async () => {
    const policy = adapter(state);
    for (const id of active) {
      let ran = false;
      const response = await policy.route(id, {}, () => { ran = true; return Response.json({ ok: true }); })(request());
      assert.equal(response.status, 403, id);
      assert.equal((await response.json()).code, 'ACCOUNT_RESTRICTED', id);
      assert.equal(ran, false, `${id} must not run`);
    }
  });

  test(`a ${state} account can still use the operations that leave, appeal, read or clean up`, async () => {
    const policy = adapter(state);
    for (const id of any) {
      let ran = false;
      const response = await policy.route(id, {}, () => { ran = true; return Response.json({ ok: true }); })(request());
      assert.equal(response.status, 200, id);
      assert.equal(ran, true, id);
    }
  });
}

test('an active account, and one with no security record, passes every operation', async () => {
  for (const state of ['active', undefined]) {
    const policy = adapter(state);
    for (const id of [...active, ...any]) {
      const response = await policy.route(id, {}, () => Response.json({ ok: true }))(request());
      assert.equal(response.status, 200, `${id} ${state}`);
    }
  }
});

test('when the account state cannot be read the write is refused (fail closed), reads still work', async () => {
  const policy = loadPolicy({
    '@/lib/auth/session': { getCurrentUser: async () => ({ uid: 'uid-1', email: 'a@example.com', name: 'A', picture: null }), isSameOrigin: () => true, publicAppOrigin: () => ORIGIN },
    '@/lib/security/marketplace-policy': loadModule('src/lib/security/marketplace-policy.ts', { stubs: {
      'node:crypto': { createHash },
      '@/lib/db/firestore': { firestore: () => ({ collection: () => ({ doc: () => ({ get: async () => { throw new Error('down'); } }) }) }) },
    } }),
  }, { NEXT_PUBLIC_SITE_URL: ORIGIN });
  const write = await policy.route('profile.update', {}, () => Response.json({ ok: true }))(request());
  assert.equal(write.status, 503);
  assert.equal((await write.json()).code, 'SECURITY_CHECK_UNAVAILABLE');
  assert.equal((await policy.route('profile.read', {}, () => Response.json({ ok: true }))(request())).status, 200);
});

test('profile PUT, a newly covered route, is denied for a restricted account and writes nothing', async () => {
  const db = createFakeFirestore({ accountSecurity: { 'uid-1': { state: 'restricted' } } });
  const marketplace = loadModule('src/lib/security/marketplace-policy.ts', { stubs: { 'node:crypto': { createHash }, '@/lib/db/firestore': { firestore: () => db } } });
  const policy = loadPolicy({
    '@/lib/auth/session': { getCurrentUser: async () => ({ uid: 'uid-1', email: 'a@example.com', name: 'A', picture: null }), isSameOrigin: () => true, publicAppOrigin: () => ORIGIN },
    '@/lib/security/marketplace-policy': { accountWriteDenied: marketplace.accountWriteDenied },
  }, { NEXT_PUBLIC_SITE_URL: ORIGIN });
  const route = loadModule('src/app/api/marketplace/profile/route.ts', { stubs: {
    'firebase-admin/firestore': { FieldValue: { delete: () => null, serverTimestamp: () => 'now' }, Timestamp: { now: () => ({ toMillis: () => 0 }), fromMillis: v => v } },
    'next/server': { NextResponse: { json: (value, init) => Response.json(value, init) } },
    '@/lib/db/firestore': { firestore: () => db },
    '@/lib/membership/access': { getMembershipAccess: async () => ({}) },
    '@/lib/security/policy': policy,
  } });
  const response = await route.PUT(new Request(`${ORIGIN}/api/marketplace/profile`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ profile: { name: 'X' } }) }));
  assert.equal(response.status, 403);
  assert.equal(db.docs('profiles')['uid-1'], undefined);
});
