import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server.js';
import { loadModule } from './helpers/load-ts.mjs';

const cookieModule = (NODE_ENV) => loadModule('src/lib/auth/session-cookie.ts', { env: NODE_ENV ? { NODE_ENV } : {} });
const sha = (value) => createHash('sha256').update(value).digest('hex');

test('the session cookie is __Host- prefixed in production and plain in development; the legacy name is always accepted', () => {
  const prod = cookieModule('production');
  assert.equal(prod.SESSION_COOKIE, '__Host-fz_session');
  assert.deepEqual([...prod.SESSION_COOKIE_NAMES], ['__Host-fz_session', 'fz_session']);
  const dev = cookieModule('development');
  assert.equal(dev.SESSION_COOKIE, 'fz_session');
  assert.deepEqual([...dev.SESSION_COOKIE_NAMES], ['fz_session']);
  assert.equal(cookieModule().SESSION_COOKIE, 'fz_session');
  assert.equal(prod.sessionCookieName(true), '__Host-fz_session');
});

test('pickSessionCookie prefers the current name and falls back to the legacy cookie', () => {
  const prod = cookieModule('production');
  const jar = (values) => (name) => values[name];
  assert.equal(prod.pickSessionCookie(jar({ '__Host-fz_session': 'new', fz_session: 'old' })), 'new');
  assert.equal(prod.pickSessionCookie(jar({ fz_session: 'old' })), 'old');
  assert.equal(prod.pickSessionCookie(jar({})), undefined);
  assert.deepEqual([...prod.allSessionCookies(jar({ '__Host-fz_session': 'new', fz_session: 'old' }))], ['new', 'old']);
});

function sessionFixture({ NODE_ENV = 'production', cookies = {}, revoked = new Set(), verified = [], firestoreDown = false } = {}) {
  const docs = new Map([...revoked].map((id) => [`revokedSessions/${id}`, { createdAt: 1 }]));
  const writes = [];
  const db = { collection: (name) => ({ doc: (id) => ({
    get: async () => { if (firestoreDown) throw new Error('down'); return { exists: docs.has(`${name}/${id}`) }; },
    set: async (value) => { if (firestoreDown) throw new Error('down'); docs.set(`${name}/${id}`, value); writes.push([`${name}/${id}`, value]); },
  }) }) };
  const stubs = {
    'next/headers': { cookies: async () => ({ get: (name) => (name in cookies ? { value: cookies[name] } : undefined) }) },
    'firebase-admin/firestore': { Timestamp: { now: () => ({ ms: 1 }), fromMillis: (ms) => ({ ms }) } },
    'node:crypto': { createHash },
    '@/lib/db/firestore': { firestore: () => db },
    '@/lib/auth/firebase-admin': { adminAuth: () => ({ verifySessionCookie: async (value, check) => { verified.push([value, check]); return { uid: 'u1', email: 'a@b.co', exp: 2_000_000_000, firebase: { sign_in_provider: 'google.com' } }; } }) },
  };
  stubs['./firebase-admin'] = stubs['@/lib/auth/firebase-admin'];
  const env = { NODE_ENV, NEXT_PUBLIC_SITE_URL: 'https://freelance-place.com' };
  const revocation = loadModule('src/lib/auth/session-revocation.ts', { env, stubs });
  const session = loadModule('src/lib/auth/session.ts', { env, stubs: { ...stubs, './session-revocation': revocation, './session-cookie': loadModule('src/lib/auth/session-cookie.ts', { env }) } });
  return { revocation, session, docs, writes, verified, stubs, env };
}

test('getCurrentUser accepts the __Host- cookie and, until it expires, the legacy cookie', async () => {
  const current = sessionFixture({ cookies: { '__Host-fz_session': 'new-cookie' } });
  assert.equal((await current.session.getCurrentUser()).uid, 'u1');
  assert.deepEqual(current.verified, [['new-cookie', true]]);
  const legacy = sessionFixture({ cookies: { fz_session: 'old-cookie' } });
  assert.equal((await legacy.session.getCurrentUser()).uid, 'u1');
  assert.deepEqual(legacy.verified, [['old-cookie', true]]);
  assert.equal(await sessionFixture().session.getCurrentUser(), null);
});

test('a denylisted cookie is rejected before any token verification, under either cookie name', async () => {
  for (const name of ['__Host-fz_session', 'fz_session']) {
    const f = sessionFixture({ cookies: { [name]: 'stolen' }, revoked: new Set([sha('stolen')]) });
    assert.equal(await f.session.getCurrentUser(), null, name);
    assert.deepEqual(f.verified, []);
  }
});

test('the denylist fails closed when Firestore cannot be read', async () => {
  const f = sessionFixture({ cookies: { fz_session: 'c' }, firestoreDown: true });
  assert.equal(await f.session.getCurrentUser(), null);
  assert.equal(await f.revocation.isSessionRevoked('c'), true);
});

test('revokeSessionCookie stores only the hash, expiring with the cookie, and the cookie is then rejected', async () => {
  const f = sessionFixture({ cookies: { fz_session: 'signed-out' } });
  assert.equal((await f.session.getCurrentUser()).uid, 'u1');
  assert.equal(await f.revocation.revokeSessionCookie('signed-out'), true);
  const [[key, value]] = f.writes;
  assert.equal(key, `revokedSessions/${sha('signed-out')}`);
  assert.equal(value.expiresAt.ms, 2_000_000_000 * 1000);
  assert.ok(!JSON.stringify(f.writes).includes('signed-out'));
  assert.equal(await f.session.getCurrentUser(), null);
  assert.equal(await sessionFixture({ firestoreDown: true }).revocation.revokeSessionCookie('x'), false);
});

function routeFixture(cookies, NODE_ENV = 'production', revokeOk = true) {
  const f = sessionFixture({ NODE_ENV, cookies });
  const revoked = [];
  const names = loadModule('src/lib/auth/session-cookie.ts', { env: f.env });
  const route = loadModule('src/app/api/auth/session/route.ts', { env: f.env, stubs: {
    ...f.stubs,
    'next/server': { NextResponse, after: () => {} },
    '@/lib/auth/session': f.session,
    '@/lib/auth/session-cookie': names,
    '@/lib/auth/session-revocation': { revokeSessionCookie: async (value) => { revoked.push(value); return revokeOk; } },
    '@/lib/audience/signin-sync': { recordSignInContact: async () => {} },
  } });
  return { route, revoked };
}
const logout = () => new Request('https://freelance-place.com/api/auth/session', { method: 'DELETE', headers: { origin: 'https://freelance-place.com' } });

test('logout denylists every session cookie presented and clears both names', async () => {
  const { route, revoked } = routeFixture({ '__Host-fz_session': 'new', fz_session: 'old' });
  const response = await route.DELETE(logout());
  assert.equal(response.status, 200);
  assert.deepEqual(revoked, ['new', 'old']);
  const cleared = response.headers.getSetCookie();
  assert.ok(cleared.some((line) => /^__Host-fz_session=;/.test(line) && /Secure/i.test(line) && /Path=\//.test(line) && !/Domain/i.test(line)));
  assert.ok(cleared.some((line) => /^fz_session=;/.test(line)));
});

test('logout still completes when the denylist write fails, and in development only the plain cookie is used', async () => {
  const failed = routeFixture({ fz_session: 'old' }, 'production', false);
  assert.equal((await failed.route.DELETE(logout())).status, 200);
  const { route } = routeFixture({ fz_session: 'old' }, 'development');
  const response = await route.DELETE(logout());
  assert.equal(response.status, 200);
  assert.ok(!response.headers.getSetCookie().some((line) => line.startsWith('__Host-')));
});

test('the proxy treats the __Host- and the legacy cookie alike as a signed-in request', () => {
  const { proxy } = loadModule('src/proxy.ts', { stubs: { 'next/server': { NextResponse } }, env: { NODE_ENV: 'production', SITE_INDEXABLE: 'true' } });
  const robots = (cookie) => proxy(new NextRequest('https://freelance-place.com/profile/headhunter', { headers: { host: 'freelance-place.com', ...(cookie ? { cookie } : {}) } })).headers.get('x-robots-tag');
  assert.equal(robots(), null);
  assert.match(robots('__Host-fz_session=abc'), /noindex/);
  assert.match(robots('fz_session=abc'), /noindex/);
});
