import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server.js';
import { loadModule } from './helpers/load-ts.mjs';
import { createFakeFirestore } from './helpers/fake-firestore.mjs';

const ROUTES = { status: 'src/app/api/integrations/xplace/route.ts', profile: 'src/app/api/integrations/xplace/profile/route.ts', project: 'src/app/api/integrations/xplace/project/route.ts' };
const PROFILE_URL = 'https://www.xplace.com/il/u/some-freelancer';
const PROJECT_URL = 'https://www.xplace.com/il/job-bids/123456';
const user = { uid: 'secret-uid-123', name: 'Account Name', email: 'person@example.com' };

// One shared errors module so `instanceof ImportError` holds between the test and the routes.
const errorsModule = loadModule('src/lib/imports/errors.ts');
console.info = () => {};
class FakeImportError extends Error {}
function setup(kind, { enabled = true, linkEnabled = true, sameOrigin = true, currentUser = user, limit = null, importer, profileDoc, profileReadFails = false, env } = {}) {
  const calls = { limiter: [], importer: [] };
  const db = createFakeFirestore(profileDoc ? { profiles: { [user.uid]: profileDoc } } : {});
  if (profileReadFails) db.collection = () => ({ doc: () => ({ get: async () => { throw new Error('boom'); } }) });
  const fakeImport = async (target) => { calls.importer.push(target); return importer ? importer(target) : {}; };
  const route = loadModule(ROUTES[kind], {
    env: { XPLACE_IMPORT_ENABLED: enabled ? 'true' : 'false', XPLACE_LINK_IMPORT_ENABLED: linkEnabled ? 'true' : 'false', ...env },
    stubs: {
      'next/server': { NextResponse },
      'node:crypto': { createHash },
      '@/lib/auth/session': { getCurrentUser: async () => currentUser, isSameOrigin: () => sameOrigin },
      '@/lib/db/firestore': { firestore: () => db },
      '@/lib/security/rate-limit': { enforceActionLimit: async (...args) => { calls.limiter.push(args); return limit; } },
      '@/lib/imports/errors': errorsModule,
      '@/lib/imports/xplace': { importXPlaceProfile: fakeImport, importXPlaceProject: fakeImport },
    },
  });
  return { route, calls };
}
const post = (route, body) => route.POST(new Request('https://example.test/api/integrations/xplace/x', { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) }));
const urlFor = { profile: PROFILE_URL, project: PROJECT_URL };
const errors = async (response) => (await response.json());

test('GET reports both flags and the extension URL without authentication and is never cached', async () => {
  for (const enabled of [true, false]) {
    const { route } = setup('status', { enabled, currentUser: null, env: { NEXT_PUBLIC_XPLACE_EXTENSION_URL: 'https://chromewebstore.example/detail/abc' } });
    const response = await route.GET();
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { enabled, linkImport: enabled, extensionUrl: enabled ? 'https://chromewebstore.example/detail/abc' : '' });
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
  }
});

test('GET: link import needs its own flag, and only an https extension URL is exposed', async () => {
  const get = async (env, linkEnabled) => (await setup('status', { linkEnabled, env }).route.GET()).json();
  assert.deepEqual(await get({}, false), { enabled: true, linkImport: false, extensionUrl: '' });
  for (const bad of ['http://store.example/x', 'javascript:alert(1)', 'not a url', 'https://user:pw@store.example/x']) {
    assert.equal((await get({ NEXT_PUBLIC_XPLACE_EXTENSION_URL: bad }, true)).extensionUrl, '', bad);
  }
});

for (const kind of ['profile', 'project']) {
  test(`${kind}: the link route is IMPORT_DISABLED while only the master flag is on`, async () => {
    const { route, calls } = setup(kind, { linkEnabled: false });
    const response = await post(route, { url: urlFor[kind], attested: true });
    assert.equal(response.status, 503);
    assert.equal((await errors(response)).code, 'IMPORT_DISABLED');
    assert.equal(calls.limiter.length + calls.importer.length, 0);
  });
}

for (const kind of ['profile', 'project']) {
  test(`${kind}: flag off answers IMPORT_DISABLED before anything else`, async () => {
    const { route, calls } = setup(kind, { enabled: false, sameOrigin: false, currentUser: null });
    const response = await post(route, '{unread');
    assert.equal(response.status, 503);
    assert.equal((await errors(response)).code, 'IMPORT_DISABLED');
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    assert.equal(calls.limiter.length + calls.importer.length, 0);
  });

  test(`${kind}: cross-origin 403 and unauthenticated 401`, async () => {
    let { route } = setup(kind, { sameOrigin: false });
    let response = await post(route, { url: urlFor[kind], attested: true });
    assert.equal(response.status, 403);
    assert.equal((await errors(response)).error, 'הבקשה נדחתה.');
    ({ route } = setup(kind, { currentUser: null }));
    response = await post(route, { url: urlFor[kind], attested: true });
    assert.equal(response.status, 401);
  });

  test(`${kind}: attestation, URL kind and URL validity are checked before the limiter or importer`, async () => {
    const other = kind === 'profile' ? PROJECT_URL : PROFILE_URL;
    const cases = [
      [{ url: urlFor[kind] }, 'ATTESTATION_REQUIRED'], [{ url: urlFor[kind], attested: 'true' }, 'ATTESTATION_REQUIRED'], [{ url: urlFor[kind], attested: false }, 'ATTESTATION_REQUIRED'],
      [{ url: other, attested: true }, 'INVALID_URL'], [{ url: 'https://evil.example/il/u/x', attested: true }, 'INVALID_URL'], [{ url: 42, attested: true }, 'INVALID_URL'], [{ attested: true }, 'INVALID_URL'],
    ];
    for (const [body, code] of cases) {
      const { route, calls } = setup(kind);
      const response = await post(route, body);
      assert.equal(response.status, 400, JSON.stringify(body));
      assert.equal((await errors(response)).code, code);
      assert.equal(response.headers.get('Cache-Control'), 'no-store');
      assert.equal(calls.limiter.length + calls.importer.length, 0, 'limiter and importer must not run for invalid input');
    }
  });

  test(`${kind}: oversized or malformed bodies are rejected by readJsonBody`, async () => {
    const { route, calls } = setup(kind);
    assert.equal((await post(route, '{bad')).status, 400);
    assert.equal((await post(route, JSON.stringify({ url: 'x'.repeat(3000), attested: true }))).status, 413);
    assert.equal(calls.limiter.length, 0);
  });

  test(`${kind}: a limited account gets the limiter response and the importer never runs`, async () => {
    const limited = Response.json({ code: 'RATE_LIMITED' }, { status: 429, headers: { 'Retry-After': '9' } });
    const { route, calls } = setup(kind, { limit: limited });
    const response = await post(route, { url: urlFor[kind], attested: true });
    assert.equal(response, limited);
    assert.deepEqual(calls.limiter, [[user.uid, 'import.xplace']]);
    assert.equal(calls.importer.length, 0);
  });

  test(`${kind}: ImportError maps through importErrorResponse, anything else becomes UPSTREAM_UNAVAILABLE`, async () => {
    for (const [code, status] of [['NOT_FOUND', 404], ['NOT_ENOUGH_DATA', 422], ['UPSTREAM_UNAVAILABLE', 502], ['RATE_LIMITED', 429]]) {
      const { route } = setup(kind, { importer: async () => { throw new errorsModule.ImportError(code, 12); } });
      const response = await post(route, { url: urlFor[kind], attested: true });
      assert.equal(response.status, status, code);
      assert.equal((await errors(response)).code, code);
      assert.equal(response.headers.get('Cache-Control'), 'no-store');
      if (code === 'RATE_LIMITED') assert.equal(response.headers.get('Retry-After'), '12');
    }
    const { route } = setup(kind, { importer: async () => { throw new FakeImportError('unexpected'); } });
    const response = await post(route, { url: urlFor[kind], attested: true });
    assert.equal(response.status, 502);
    assert.equal((await errors(response)).code, 'UPSTREAM_UNAVAILABLE');
  });
}

test('profile: success returns the importer result with no-store and passes the parsed target', async () => {
  const result = { provider: 'xplace', url: PROFILE_URL, sourceText: 'text', profile: {}, fetchedAt: 'now', warnings: [] };
  const { route, calls } = setup('profile', { importer: async () => result });
  const response = await post(route, { url: 'xplace.com/u/some-freelancer/', attested: true });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), result);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.equal(calls.importer[0].kind, 'profile');
  assert.equal(calls.importer[0].canonicalUrl, PROFILE_URL);
});

const projectResult = (publisherName) => ({ provider: 'xplace', url: PROJECT_URL, externalId: '123456', draft: { title: 'T', description: 'D', category: 'כללי', budget: '', deadline: 'גמיש', skills: [] }, partial: false, publisherName, fetchedAt: 'now', warnings: ['w'] });

test('project: publisher block for match, mismatch, unknown and no-profile', async () => {
  const cases = [
    { publisherName: 'Acme Studio', profileDoc: { name: ' Acme Studio ' }, match: 'match', profileName: 'Acme Studio', suggested: 'Acme Studio' },
    { publisherName: 'Totally Different', profileDoc: { name: 'Acme Studio' }, match: 'mismatch', profileName: 'Acme Studio', suggested: 'Totally Different' },
    { publisherName: '', profileDoc: { name: 'Acme Studio' }, match: 'unknown', profileName: 'Acme Studio', suggested: 'Account Name' },
    { publisherName: 'Acme Studio', profileDoc: undefined, match: 'no-profile', profileName: '', suggested: 'Acme Studio' },
    { publisherName: '', profileDoc: { name: 12 }, match: 'no-profile', profileName: '', suggested: 'Account Name' },
  ];
  for (const item of cases) {
    const { route } = setup('project', { importer: async () => projectResult(item.publisherName), profileDoc: item.profileDoc });
    const response = await post(route, { url: '/project?id=1'.replace('/project?id=1', 'xplace.com/project?id=123456'), attested: true });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.publisherName, undefined, 'raw importer field must not leak');
    assert.deepEqual(body.publisher, { sourceName: item.publisherName, match: item.match, profileName: item.profileName, suggestedName: item.suggested });
    assert.deepEqual(body.draft, projectResult('').draft);
    assert.equal(body.externalId, '123456');
    assert.equal(body.partial, false);
    assert.deepEqual(body.warnings, ['w']);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
  }
});

test('project: suggestedName falls back to the email local part and a profile read failure is a 503', async () => {
  const { route } = setup('project', { currentUser: { uid: user.uid, email: 'local@example.com' }, importer: async () => projectResult('') });
  assert.equal((await (await post(route, { url: PROJECT_URL, attested: true })).json()).publisher.suggestedName, 'local');
  const failing = setup('project', { profileReadFails: true, importer: async () => projectResult('Acme') });
  const response = await post(failing.route, { url: PROJECT_URL, attested: true });
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error, 'לא הצלחנו לבדוק את פרופיל המפרסם. נסו שוב.');
});

test('logs carry one xplace_import line with a URL hash and never the raw URL or the user id', async () => {
  const original = console.info;
  const lines = [];
  console.info = (line) => lines.push(String(line));
  try {
    for (const kind of ['profile', 'project']) {
      const { route } = setup(kind, { importer: async () => (kind === 'project' ? projectResult('Acme') : { provider: 'xplace' }) });
      await post(route, { url: urlFor[kind], attested: true });
    }
    const failing = setup('profile', { importer: async () => { throw new FakeImportError('x'); } });
    await post(failing.route, { url: PROFILE_URL, attested: true });
  } finally { console.info = original; }
  assert.equal(lines.length, 3);
  for (const line of lines) {
    const entry = JSON.parse(line);
    assert.equal(entry.event, 'xplace_import');
    assert.ok(['profile', 'project'].includes(entry.kind));
    assert.equal(typeof entry.durationMs, 'number');
    assert.match(entry.urlSha256, /^[0-9a-f]{64}$/);
    for (const secret of ['xplace.com', 'some-freelancer', '123456', user.uid, 'person@example.com']) assert.equal(line.includes(secret), false, secret);
  }
  assert.equal(JSON.parse(lines[0]).urlSha256, createHash('sha256').update(PROFILE_URL).digest('hex'));
  assert.equal(JSON.parse(lines[2]).status, 'UPSTREAM_UNAVAILABLE');
});

test('/api/ai/profile accepts xplace, rejects other providers and more than four sources', async () => {
  const profile = loadModule('src/lib/profile-generation.ts');
  assert.deepEqual([...profile.SOCIAL_SOURCE_PROVIDERS], ['github', 'linkedin', 'dribbble', 'xplace']);
  const route = loadModule('src/app/api/ai/profile/route.ts', { stubs: {
    'next/server': { NextResponse }, 'node:crypto': { createHash, randomUUID: () => 'id' },
    '@/lib/auth/session': { isSameOrigin: () => true, getCurrentUser: async () => user },
    '@/lib/db/firestore': {}, '@/lib/db/storage': {},
    '@/lib/security/rate-limit': { enforceActionLimit: async () => null },
    '@/lib/ai': { isVertexConfigured: () => false, safePublicUrl: () => true, generateWithVertex: async () => { throw new Error('unexpected'); } },
  }, env: {} });
  const run = async (sources) => {
    const form = new FormData();
    form.set('socialSources', JSON.stringify(sources));
    const response = await route.POST(new Request('https://example.test/api/ai/profile', { method: 'POST', body: form }));
    return response.status;
  };
  const source = (provider) => ({ provider, sourceText: 'text' });
  // Vertex is unconfigured, so a valid request reaches the demo response (200) and an invalid one stops with 400.
  assert.equal(await run([source('xplace')]), 200);
  assert.equal(await run(['github', 'linkedin', 'dribbble', 'xplace'].map(source)), 200);
  assert.equal(await run([source('twitter')]), 400);
  assert.equal(await run(['github', 'linkedin', 'dribbble', 'xplace', 'github'].map(source)), 400);
  assert.equal(await run([source('xplace'), source('xplace')]), 400);
});
