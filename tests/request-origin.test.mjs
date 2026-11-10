import { loadModule } from './helpers/load-ts.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server.js';

function load(path, env, stubs) {
  const module = { exports: {} };
  const code = ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(code, { module, exports: module.exports, URL, Buffer, process: { env }, require(name) {
    if (name in stubs) return stubs[name];
    throw new Error(`Unexpected dependency: ${name}`);
  } });
  return module.exports;
}
const env = { NODE_ENV: 'production', NEXT_PUBLIC_SITE_URL: 'https://freelance-place.com' };
function session(config = env) {
  return load('src/lib/auth/session.ts', config, { 'server-only': {}, 'next/headers': {}, './firebase-admin': {} });
}
const { isSameOrigin } = session();
const backend = 'http://localhost:8080/api/integrations/nango/session';

test('accepts the configured public HTTPS origin behind the Cloud Run proxy', () => {
  assert.equal(isSameOrigin(new Request(backend, { headers: { origin: 'https://freelance-place.com' } })), true);
  assert.equal(isSameOrigin(new Request(backend, { headers: { referer: 'https://freelance-place.com/profile/import' } })), true);
});

test('rejects cross-origin requests, spoofed forwarding headers, and missing origins', () => {
  for (const headers of [
    { origin: 'https://attacker.example', 'x-forwarded-host': 'attacker.example', host: 'attacker.example' },
    { origin: 'http://localhost:8080' },
    { origin: 'https://freelance-place.com.attacker.example' },
    { origin: 'null', referer: 'https://freelance-place.com/profile/import' },
    { referer: 'invalid' },
    {},
  ]) assert.equal(isSameOrigin(new Request(backend, { headers })), false);
});

test('allows localhost development without opening production to internal origins', () => {
  const local = session({ NODE_ENV: 'development' }).isSameOrigin;
  assert.equal(local(new Request('http://localhost:3000/api/auth/session', { headers: { origin: 'http://localhost:3000' } })), true);
  assert.equal(local(new Request('http://localhost:3000/api/auth/session', { headers: { origin: 'http://localhost:3001' } })), false);
});

test('session creation uses the same origin check and retains CSRF validation', async () => {
  const route = load('src/app/api/auth/session/route.ts', env, {
    '@/lib/security/request-body': loadModule('src/lib/security/request-body.ts'),
    'node:crypto': { timingSafeEqual },
    'next/headers': { cookies: async () => ({ get: () => undefined }) },
    'next/server': { NextResponse },
    '@/lib/auth/firebase-admin': {},
    '@/lib/auth/session': session(),
    '@/lib/support/shared': load('src/lib/support/shared.ts', {}, {}),
  });
  const validOrigin = await route.POST(new Request(backend, { method: 'POST', headers: { origin: env.NEXT_PUBLIC_SITE_URL, 'Content-Type': 'application/json' }, body: '{}' }));
  assert.equal((await validOrigin.json()).error, 'Refresh the page and try again.');
  const missingOrigin = await route.POST(new Request(backend, { method: 'POST', body: '{}' }));
  assert.equal((await missingOrigin.json()).error, 'Invalid request origin.');
});

test('Dribbble redirects use the public origin rather than the internal proxy URL', async () => {
  const common = {
    'next/server': { NextResponse },
    'next/headers': { cookies: async () => ({ get: () => undefined, delete: () => {} }) },
    '@/lib/auth/session': { ...session(), getCurrentUser: async () => null },
    '@/lib/integrations/dribbble': {},
    'firebase-admin/firestore': {},
    '@/lib/db/firestore': {},
  };
  for (const path of ['connect', 'callback']) {
    const route = load(`src/app/api/integrations/dribbble/${path}/route.ts`, env, common);
    const response = await route.GET(new Request(`http://localhost:8080/api/integrations/dribbble/${path}`));
    assert.equal(response.headers.get('location'), 'https://freelance-place.com/signin?next=%2Fprofile%2Fimport');
  }
  const callback = load('src/app/api/integrations/dribbble/callback/route.ts', env, {
    ...common,
    '@/lib/auth/session': { ...session(), getCurrentUser: async () => ({ uid: 'owner' }) },
    '@/lib/integrations/dribbble': { validateDribbbleOAuthState: () => false },
  });
  const response = await callback.GET(new Request('http://localhost:8080/api/integrations/dribbble/callback?state=wrong'));
  assert.equal(response.headers.get('location'), 'https://freelance-place.com/profile/import?dribbble=state-error');
});
