import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { loadModule, projectRoot } from './helpers/load-ts.mjs';
import * as script from '../scripts/indexnow-submit.mjs';

const { SITE_URL } = loadModule('src/lib/seo/site.ts');
const HOST = new URL(SITE_URL).host;
const live = { SITE_INDEXABLE: 'true', NEXT_PUBLIC_SITE_URL: SITE_URL };
const OTHER_HOST_URL = `https://other-${HOST}`;
const plain = (value) => JSON.parse(JSON.stringify(value));
const indexnowFor = (env = live) => loadModule('src/lib/seo/indexnow.ts', { env });
const { DEFAULT_INDEXNOW_KEY: KEY, INDEXNOW_ENDPOINT, INDEXNOW_MAX_URLS } = indexnowFor();

const respond = (status = 200) => new Response(status === 202 ? 'accepted' : '', { status });
// A fetch that records its calls; `handler` decides the answer.
function recorder(handler = () => respond(200)) {
  const calls = [];
  const fetch = async (url, init = {}) => { calls.push({ url, init }); return handler(url, init, calls.length); };
  return Object.assign(fetch, { calls });
}
// Everything the code logs while the test runs, so a test can also assert what is NOT logged.
function captureConsole(t) {
  const lines = [];
  for (const method of ['log', 'info', 'warn', 'error']) t.mock.method(console, method, (...args) => { lines.push({ method, args: plain(args) }); });
  return lines;
}

// ---------------------------------------------------------------------------------------------
// The key file and the key
// ---------------------------------------------------------------------------------------------

test('the key file in public/ is named after the key and contains exactly the key', () => {
  const file = readFileSync(`${projectRoot}/public/${KEY}.txt`);
  assert.equal(file.toString('utf8'), KEY, 'the key only: no newline, no byte order mark, no padding');
  assert.equal(file.length, KEY.length);
  assert.match(KEY, /^[A-Za-z0-9-]{8,128}$/, 'a key the protocol accepts');
  const module = indexnowFor();
  assert.equal(module.indexNowKey({}), KEY);
  assert.equal(module.indexNowKeyLocation({}), `${SITE_URL}/${KEY}.txt`);
  assert.equal(INDEXNOW_ENDPOINT, 'https://api.indexnow.org/indexnow');
  assert.equal(INDEXNOW_MAX_URLS, 10_000);
});

test('INDEXNOW_KEY overrides the key only when the protocol would accept it', () => {
  const { indexNowKey, indexNowKeyLocation } = indexnowFor();
  const rotated = 'rotated-key-2027-abcdef';
  assert.equal(indexNowKey({ INDEXNOW_KEY: rotated }), rotated);
  assert.equal(indexNowKey({ INDEXNOW_KEY: `  ${rotated}\n` }), rotated);
  assert.equal(indexNowKeyLocation({ INDEXNOW_KEY: rotated }), `${SITE_URL}/${rotated}.txt`);
  assert.equal(indexNowKey({ INDEXNOW_KEY: 'a'.repeat(8) }), 'a'.repeat(8));
  assert.equal(indexNowKey({ INDEXNOW_KEY: 'a'.repeat(128) }), 'a'.repeat(128));
  for (const rejected of ['', '   ', 'a'.repeat(7), 'a'.repeat(129), 'has a space in it', 'ключ-ключ-ключ', 'with/slash-1234', 'dot.dot.dot.dot']) {
    assert.equal(indexNowKey({ INDEXNOW_KEY: rejected }), KEY, JSON.stringify(rejected));
  }
  // The process environment is the default source.
  const payload = indexnowFor({ ...live, INDEXNOW_KEY: rotated }).buildIndexNowPayload([`${SITE_URL}/projects/a`]);
  assert.equal(payload.key, rotated);
  assert.equal(payload.keyLocation, `${SITE_URL}/${rotated}.txt`);
});

// ---------------------------------------------------------------------------------------------
// URL filtering and the payload
// ---------------------------------------------------------------------------------------------

test('only absolute URLs on the site origin are announced: de-duplicated, no fragments, no account or API paths', () => {
  const { normalizeIndexNowUrls } = indexnowFor();
  const at = (path) => `${SITE_URL}${path}`;
  const input = [
    at('/projects/abc'), at('/projects/abc'), at('/projects/abc#reviews'), `${SITE_URL}/projects/abc/`.slice(0, -1),
    at('/categories/design'),
    `${SITE_URL.toUpperCase()}/projects/MixedCase`,
    at('/projects/new-ideas'),
    `https://www.${HOST}/projects/abc`, OTHER_HOST_URL, `${OTHER_HOST_URL}/projects/abc`,
    `http://${HOST}/projects/insecure`, `https://${HOST}:8443/projects/port`, `https://user:secret@${HOST}/projects/credentials`,
    at('/api/marketplace/projects'), at('/api'), at('/%61pi/secret'),
    at('/messages'), at('/messages/thread-1'), at('/membership'), at('/profile'), at('/signin'), at('/projects/new'),
    '/projects/relative', 'projects/abc', 'not a url', '', 42, null, undefined, {}, ['array'],
  ];
  assert.deepEqual(plain(normalizeIndexNowUrls(input)), [
    at('/projects/abc'), at('/categories/design'), at('/projects/MixedCase'), at('/projects/new-ideas'),
  ]);
  // Any iterable works, and a query string is kept.
  assert.deepEqual(plain(normalizeIndexNowUrls(new Set([at('/a?x=1')]))), [at('/a?x=1')]);
  assert.deepEqual(plain(normalizeIndexNowUrls((function* () { yield at('/g'); })())), [at('/g')]);
});

test('a batch is capped at the protocol limit and at any smaller limit', () => {
  const { normalizeIndexNowUrls } = indexnowFor();
  const many = Array.from({ length: INDEXNOW_MAX_URLS + 2_000 }, (_, index) => `${SITE_URL}/projects/p${index}`);
  assert.equal(normalizeIndexNowUrls(many).length, INDEXNOW_MAX_URLS);
  assert.equal(normalizeIndexNowUrls(many, 1_000_000).length, INDEXNOW_MAX_URLS, 'never above the protocol limit');
  assert.equal(normalizeIndexNowUrls(many, Infinity).length, INDEXNOW_MAX_URLS);
  assert.deepEqual(plain(normalizeIndexNowUrls(many, 3)), many.slice(0, 3), 'the first URLs win');
  assert.equal(normalizeIndexNowUrls(many, 2.9).length, 2);
  for (const nothing of [0, -5, Number.NaN]) assert.equal(normalizeIndexNowUrls(many, nothing).length, 0, String(nothing));
});

test('the payload carries host, key, key location and the filtered URL list in the protocol format', () => {
  const { buildIndexNowPayload } = indexnowFor();
  const urls = [`${SITE_URL}/projects/a`, `${SITE_URL}/categories/design`];
  const payload = buildIndexNowPayload([...urls, `${OTHER_HOST_URL}/x`, `${SITE_URL}/api/x`, urls[0]]);
  assert.deepEqual(plain(payload), { host: HOST, key: KEY, keyLocation: `${SITE_URL}/${KEY}.txt`, urlList: urls });
  assert.deepEqual(Object.keys(payload), ['host', 'key', 'keyLocation', 'urlList']);
  assert.deepEqual(plain(buildIndexNowPayload(urls, 1).urlList), [urls[0]]);
  assert.deepEqual(plain(buildIndexNowPayload([]).urlList), []);
});

// ---------------------------------------------------------------------------------------------
// Submitting
// ---------------------------------------------------------------------------------------------

test('submitting is a no-op unless indexing is enabled, and when nothing is left to announce', async () => {
  const urls = [`${SITE_URL}/projects/a`];
  for (const env of [{}, { SITE_INDEXABLE: 'false' }, { SITE_INDEXABLE: '' }, { SITE_INDEXABLE: 'TRUE' }, { SITE_INDEXABLE: '1' }]) {
    const fetch = recorder();
    const result = await indexnowFor(env).submitIndexNow(urls, { fetch });
    assert.deepEqual(plain(result), { ok: false, submitted: 0, status: null, reason: 'disabled' }, JSON.stringify(env));
    assert.equal(fetch.calls.length, 0, 'a preview never contacts IndexNow');
  }
  const { submitIndexNow } = indexnowFor();
  for (const nothing of [[], [`${OTHER_HOST_URL}/x`, `${SITE_URL}/api/x`, 'nope', 3]]) {
    const fetch = recorder();
    assert.deepEqual(plain(await submitIndexNow(nothing, { fetch })), { ok: false, submitted: 0, status: null, reason: 'no-urls' });
    assert.equal(fetch.calls.length, 0);
  }
});

test('a submission is one JSON POST to the shared endpoint, and 200 and 202 both count as accepted', async (t) => {
  captureConsole(t);
  const { submitIndexNow, buildIndexNowPayload } = indexnowFor();
  const urls = [`${SITE_URL}/projects/a`, `${SITE_URL}/projects/b`];
  for (const status of [200, 202]) {
    const fetch = recorder(() => respond(status));
    assert.deepEqual(plain(await submitIndexNow(urls, { fetch })), { ok: true, submitted: 2, status });
    assert.equal(fetch.calls.length, 1);
    const { url, init } = fetch.calls[0];
    assert.equal(url, 'https://api.indexnow.org/indexnow');
    assert.equal(init.method, 'POST');
    assert.equal(init.headers['Content-Type'], 'application/json; charset=utf-8');
    assert.equal(init.redirect, 'manual', 'the payload is never forwarded to a redirect target');
    assert.ok(init.signal instanceof AbortSignal && !init.signal.aborted, 'a timeout signal that has not fired');
    assert.deepEqual(JSON.parse(init.body), plain(buildIndexNowPayload(urls)));
  }
  // The submitted list is the filtered one, and the options reach the request.
  const fetch = recorder();
  const mixed = [urls[0], `${OTHER_HOST_URL}/x`, `${SITE_URL}/api/x`, urls[0], urls[1]];
  assert.deepEqual(plain(await submitIndexNow(mixed, { fetch, endpoint: `${SITE_URL}/sink`, limit: 1 })), { ok: true, submitted: 1, status: 200 });
  assert.equal(fetch.calls[0].url, `${SITE_URL}/sink`);
  assert.deepEqual(JSON.parse(fetch.calls[0].init.body).urlList, [urls[0]]);
});

test('rejections, network failures and timeouts never throw and report nothing as submitted', async (t) => {
  const lines = captureConsole(t);
  const { submitIndexNow } = indexnowFor();
  const urls = [`${SITE_URL}/projects/a`, `${SITE_URL}/projects/b`];
  for (const status of [400, 403, 422, 429, 500, 503]) {
    const result = await submitIndexNow(urls, { fetch: recorder(() => respond(status)) });
    assert.deepEqual(plain(result), { ok: false, submitted: 0, status, reason: 'rejected' });
  }
  const failed = { ok: false, submitted: 0, status: null, reason: 'failed' };
  const hanging = (_url, init) => new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))));
  for (const [label, fetch] of Object.entries({
    'a network error': async () => { throw new TypeError('fetch failed'); },
    'a non-error rejection': () => Promise.reject('plain string'),
    'a synchronous throw': () => { throw new Error('synchronous'); },
    'a request that never answers': hanging,
  })) {
    assert.deepEqual(plain(await submitIndexNow(urls, { fetch, timeoutMs: 25 })), failed, label);
  }
  assert.deepEqual(lines.at(-1).args, ['IndexNow submission failed', { status: 'timeout', count: 2 }], 'a timeout is reported as one');
  // A body that cannot be cancelled and a URL source that throws while it is read change nothing.
  const stubborn = recorder(() => ({ status: 200, body: { cancel: () => Promise.reject(new Error('cancel failed')) } }));
  assert.deepEqual(plain(await submitIndexNow(urls, { fetch: stubborn })), { ok: true, submitted: 2, status: 200 });
  const broken = (function* () { yield urls[0]; throw new Error('broken source'); })();
  assert.deepEqual(plain(await submitIndexNow(broken, { fetch: recorder() })), failed);
});

test('submission logs carry only the status and the number of URLs, never a URL, the key or the payload', async (t) => {
  const lines = captureConsole(t);
  const { submitIndexNow } = indexnowFor();
  const urls = [`${SITE_URL}/projects/secret-looking-slug`, `${SITE_URL}/categories/design`];
  await submitIndexNow(urls, { fetch: recorder(() => respond(202)) });
  await submitIndexNow(urls, { fetch: recorder(() => respond(403)) });
  await submitIndexNow(urls, { fetch: async () => { throw new Error(`failed for ${urls[0]}`); } });
  assert.deepEqual(lines.map(({ method, args }) => [method, ...args]), [
    ['info', 'IndexNow submission', { status: 202, count: 2 }],
    ['warn', 'IndexNow submission', { status: 403, count: 2 }],
    ['warn', 'IndexNow submission failed', { status: 'error', count: 2 }],
  ]);
  const text = JSON.stringify(lines);
  for (const secret of [HOST, 'secret-looking-slug', '/categories/', KEY, 'urlList', 'keyLocation', 'api.indexnow.org']) assert.equal(text.includes(secret), false, secret);
});

// ---------------------------------------------------------------------------------------------
// Project lifecycle hooks
// ---------------------------------------------------------------------------------------------

const openProject = { title: 'עיצוב לוגו לעסק חדש', description: 'תיאור מלא של הפרויקט עבור בעלי מקצוע.', category: 'עיצוב וגרפיקה', skills: ['Figma'], status: 'open', ownerUid: 'owner-1' };
const tagsFor = (slug) => [['projects', { expire: 0 }], [`project:${slug}`, { expire: 0 }]];

// Next's request-scoped primitives and the IndexNow client are stubbed; everything else is the real code.
function setup({ pages = ['/categories/design', '/projects'], failRevalidate = false, failAfter = false, env = live } = {}) {
  const revalidated = [];
  const scheduled = [];
  const submitted = [];
  const stubs = {
    'next/cache': { revalidateTag: (tag, profile) => { revalidated.push([tag, profile]); if (failRevalidate) throw new Error('revalidateTag outside a request'); } },
    'next/server': { after: (task) => { scheduled.push(task); if (failAfter) throw new Error('after outside a request'); } },
    '@/lib/seo/indexnow': { submitIndexNow: async (urls) => { submitted.push([...urls]); return { ok: true }; } },
    '@/lib/seo/registry': { pageByPath: (path) => (pages.includes(path) ? { path } : undefined) },
  };
  const flush = async () => { for (const task of scheduled.splice(0)) await task(); };
  return { env, stubs, revalidated, scheduled, submitted, flush, events: () => loadModule('src/lib/projects/events.ts', { env, stubs }) };
}
const HOOKS = ['onProjectPublished', 'onProjectChanged', 'onProjectClosed', 'onProjectDeleted'];

test('creating, changing, closing and deleting a project drop its public caches at once, before the response', async () => {
  const names = setup().events();
  assert.equal(names.PROJECTS_TAG, 'projects');
  assert.equal(names.projectTag('abc'), 'project:abc');
  for (const hook of HOOKS) {
    const harness = setup();
    assert.equal(harness.events()[hook]('proj-1', openProject), undefined, `${hook} is synchronous`);
    assert.deepEqual(plain(harness.revalidated), tagsFor('proj-1'), `${hook} expires both tags immediately (two-argument revalidateTag)`);
    assert.equal(harness.scheduled.length, 1, `${hook} leaves only the IndexNow ping for after()`);
    assert.equal(harness.submitted.length, 0, `${hook} does not ping before the response is sent`);
    await harness.flush();
    assert.equal(harness.submitted.length, 1, hook);
  }
  const direct = setup();
  direct.events().invalidateProjectCache('proj-2');
  assert.deepEqual(plain(direct.revalidated), tagsFor('proj-2'));
  assert.equal(direct.scheduled.length, 0, 'invalidating alone does not ping');
});

test('the IndexNow ping names the project page, its category page and the hubs the registry knows', async () => {
  const project = `${SITE_URL}/projects/p1`;
  const category = `${SITE_URL}/categories/design`;
  const hub = `${SITE_URL}/projects`;
  const cases = [
    ['everything known', ['/categories/design', '/projects'], openProject, [project, category, hub]],
    ['no hub yet', ['/categories/design'], openProject, [project, category]],
    ['a registry that knows neither', [], openProject, [project]],
    ['a category page that is not registered', ['/categories/web-development', '/projects'], openProject, [project, hub]],
    ['a category found through a skill', ['/categories/design', '/projects'], { ...openProject, category: '', skills: ['figma'] }, [project, category, hub]],
    ['no matching category', ['/categories/design', '/projects'], { ...openProject, category: 'אחר', skills: [] }, [project, hub]],
    ['malformed category and skills', ['/categories/design'], { ...openProject, category: 42, skills: 'Figma' }, [project]],
  ];
  for (const [label, pages, record, expected] of cases) {
    for (const hook of HOOKS) {
      const harness = setup({ pages });
      harness.events()[hook]('p1', record);
      await harness.flush();
      assert.deepEqual(harness.submitted, [expected], `${label} (${hook})`);
    }
  }
  const events = setup().events();
  assert.deepEqual(plain(events.projectEventUrls('p1', openProject)), [project, category, hub]);
  for (const slug of ['../etc', 'a/b', '', '-lead', 'x'.repeat(129), 'has space', undefined, null, 42, {}]) assert.deepEqual(plain(events.projectEventUrls(slug, openProject)), [], String(slug));
  assert.equal(events.projectEventUrls('x'.repeat(128), openProject).length, 3);
});

test('only projects search engines may index are announced; everything else just drops the caches', async () => {
  const hidden = [
    ['a project that was already closed', { ...openProject, status: 'closed' }],
    ['a draft', { ...openProject, status: 'draft' }],
    ['a private project', { ...openProject, visibility: 'private' }],
    ['a sample without an AI-agent owner', { ...openProject, sample: true }],
    ['a sample with a human owner', { ...openProject, sample: true, owner: { kind: 'human' } }],
    ['a showcase project published by the AI agent', { ...openProject, sample: true, unreal: true, owner: { kind: 'ai-agent' } }],
    ['an AI-agent project without a sample flag', { ...openProject, owner: { kind: 'ai-agent' } }],
    ['a project flagged unreal', { ...openProject, unreal: true }],
    ['a project without a description', { ...openProject, description: '  ' }],
    ['a project without a title', { ...openProject, title: '' }],
    ['no record at all', undefined],
    ['an empty record', {}],
  ];
  const visible = [
    ['an open project', openProject],
    ['a public project', { ...openProject, visibility: 'public' }],
    ['a project with a human owner', { ...openProject, owner: { kind: 'human' } }],
  ];
  for (const [label, record] of hidden) {
    for (const hook of HOOKS) {
      const harness = setup();
      harness.events()[hook]('p1', record);
      assert.deepEqual(plain(harness.revalidated), tagsFor('p1'), `${label} still expires the caches (${hook})`);
      assert.equal(harness.scheduled.length, 0, `${label} is not announced (${hook})`);
    }
  }
  for (const [label, record] of visible) {
    const harness = setup();
    harness.events().onProjectClosed('p1', record);
    assert.equal(harness.scheduled.length, 1, `${label} is announced`);
  }
});

test('hooks never throw: a failing cache call, a missing request scope or a broken record cannot change a request', async (t) => {
  const lines = captureConsole(t);
  const failingCache = setup({ failRevalidate: true });
  failingCache.events().onProjectPublished('p1', openProject);
  assert.equal(failingCache.revalidated.length, 2, 'the second tag is tried even when the first call failed');
  assert.equal(failingCache.scheduled.length, 1, 'the ping does not depend on the cache call');

  const outsideRequest = setup({ failAfter: true });
  outsideRequest.events().onProjectClosed('p1', openProject);
  assert.deepEqual(plain(outsideRequest.revalidated), tagsFor('p1'));
  assert.equal(outsideRequest.scheduled.length, 1, 'after() was attempted once and its failure swallowed');

  const everythingFails = setup({ failRevalidate: true, failAfter: true });
  const events = everythingFails.events();
  const records = [null, undefined, 'text', 7, [], { get status() { throw new Error('boom'); } }, { ...openProject, skills: 'not-an-array', category: 42 }];
  for (const hook of HOOKS) {
    for (const record of records) assert.doesNotThrow(() => events[hook]('p1', record), `${hook} ${String(record)}`);
    for (const slug of [undefined, null, '', '../etc', 42, {}]) assert.doesNotThrow(() => events[hook](slug, openProject), `${hook} ${String(slug)}`);
    assert.doesNotThrow(() => events[hook]('p1'), `${hook} without a record`);
  }
  assert.doesNotThrow(() => events.invalidateProjectCache(undefined));

  // Warnings name the failure only by its class: no messages, slugs or record data.
  assert.ok(lines.length > 0 && lines.every((line) => line.method === 'warn'));
  const text = JSON.stringify(lines);
  for (const leaked of ['outside a request', 'boom', 'p1', 'עיצוב', 'owner-1']) assert.equal(text.includes(leaked), false, leaked);

  // Invalid slugs never reach the cache or IndexNow at all.
  const invalid = setup();
  invalid.events().onProjectPublished('../escape', openProject);
  assert.equal(invalid.revalidated.length, 0);
  assert.equal(invalid.scheduled.length, 0);
});

test('end to end, one discoverable project change sends one IndexNow request, and a preview sends none', async (t) => {
  captureConsole(t);
  const sent = [];
  // The test context copies the global fetch when it is created, so patch it first.
  t.mock.method(globalThis, 'fetch', async (url, init) => { sent.push({ url, body: JSON.parse(init.body) }); return respond(200); });
  const realRegistryHub = loadModule('src/lib/seo/registry.ts').pageByPath('/projects') ? [`${SITE_URL}/projects`] : [];
  const build = (env) => {
    const harness = setup({ env, pages: realRegistryHub.length ? ['/categories/design', '/projects'] : ['/categories/design'] });
    const stubs = { ...harness.stubs };
    delete stubs['@/lib/seo/indexnow'];
    return { harness, events: loadModule('src/lib/projects/events.ts', { env, stubs }) };
  };
  const expected = [`${SITE_URL}/projects/p1`, `${SITE_URL}/categories/design`, ...realRegistryHub];

  const production = build(live);
  production.events.onProjectPublished('p1', openProject);
  assert.equal(sent.length, 0, 'nothing is sent before the response');
  await production.harness.flush();
  assert.equal(sent.length, 1);
  assert.equal(sent[0].url, INDEXNOW_ENDPOINT);
  assert.deepEqual(sent[0].body, { host: HOST, key: KEY, keyLocation: `${SITE_URL}/${KEY}.txt`, urlList: expected });

  const preview = build({});
  preview.events.onProjectPublished('p1', openProject);
  assert.deepEqual(plain(preview.harness.revalidated), tagsFor('p1'), 'caches are still dropped in a preview');
  await preview.harness.flush();
  assert.equal(sent.length, 1, 'a preview announces nothing');
});

// ---------------------------------------------------------------------------------------------
// The project route calls the hooks
// ---------------------------------------------------------------------------------------------

const NEW_ID = 'b7a1c2d3-0000-4000-8000-000000000001';
const owner = { uid: 'owner-1', name: 'Test', email: 'test@example.test' };
const validBody = { title: 'לוגו לעסק חדש', description: 'תיאור מפורט של הפרויקט הדרוש לפרילנסר.', category: 'עיצוב וגרפיקה', budget: '1000', deadline: 'שבוע', skills: ['Figma'] };
const json = (method, body) => new Request(`${SITE_URL}/api/marketplace/projects`, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const transactionOver = (data) => ({ get: async () => ({ exists: data !== undefined, get: (field) => data?.[field], data: () => data }), update: () => {} });

// The real route and the real hooks over a fake Firestore.
function routeSetup({ user = owner, sameOrigin = true, docs = {}, createFails = false, runTransaction } = {}) {
  const harness = setup();
  const store = new Map(Object.entries(docs));
  const created = [];
  const firestore = {
    collection: () => ({ doc: (id) => ({ id, create: async (record) => { if (createFails) throw new Error('unavailable'); created.push([id, record]); store.set(id, record); } }) }),
    runTransaction: runTransaction ?? (async (work) => work({
      get: async (ref) => { const data = store.get(ref.id); return { exists: data !== undefined, get: (field) => data?.[field], data: () => data }; },
      update: (ref, patch) => { store.set(ref.id, { ...store.get(ref.id), ...patch }); },
    })),
  };
  const stubs = {
    ...harness.stubs,
    'next/server': { ...harness.stubs['next/server'], NextResponse: { json: (body, init) => Response.json(body, init) } },
    'firebase-admin/firestore': { FieldValue: { serverTimestamp: () => 'SERVER_TIMESTAMP' } },
    'node:crypto': { randomUUID: () => NEW_ID },
    '@/lib/auth/session': { getCurrentUser: async () => user, isSameOrigin: () => sameOrigin },
    '@/lib/db/firestore': { firestore: () => firestore },
    '@/lib/db/projects': { toPublicProject: (slug, record) => ({ slug, title: record.title }) },
  };
  return { ...harness, store, created, route: loadModule('src/app/api/marketplace/projects/route.ts', { env: live, stubs }) };
}

test('publishing a project expires its caches and announces it; a request that creates nothing announces nothing', async () => {
  const harness = routeSetup();
  const response = await harness.route.POST(json('POST', validBody));
  assert.equal(response.status, 201);
  assert.equal(harness.created.length, 1);
  assert.deepEqual(plain(harness.revalidated), tagsFor(NEW_ID));
  assert.equal(harness.submitted.length, 0, 'announced only after the response');
  await harness.flush();
  assert.deepEqual(harness.submitted, [[`${SITE_URL}/projects/${NEW_ID}`, `${SITE_URL}/categories/design`, `${SITE_URL}/projects`]]);

  for (const [label, options, body, status] of [
    ['a signed-out visitor', { user: null }, validBody, 401],
    ['a cross-origin request', { sameOrigin: false }, validBody, 403],
    ['an invalid project', {}, { ...validBody, title: 'x' }, 400],
    ['a storage failure', { createFails: true }, validBody, 503],
  ]) {
    const rejected = routeSetup(options);
    assert.equal((await rejected.route.POST(json('POST', body))).status, status, label);
    assert.equal(rejected.revalidated.length, 0, `${label} expires nothing`);
    assert.equal(rejected.scheduled.length, 0, `${label} announces nothing`);
  }
});

test('closing a project announces it only when this request closed it, judged by the project as it was before', async () => {
  const docs = {
    'proj-open': { ...openProject },
    'proj-closed': { ...openProject, status: 'closed' },
    'proj-draft': { ...openProject, status: 'draft' },
    'proj-theirs': { ...openProject, ownerUid: 'someone-else' },
    'proj-private': { ...openProject, visibility: 'private' },
  };
  const closeRequest = (slug) => json('PATCH', { slug, status: 'closed' });

  const closing = routeSetup({ docs });
  assert.equal((await closing.route.PATCH(closeRequest('proj-open'))).status, 200);
  assert.equal(closing.store.get('proj-open').status, 'closed');
  assert.deepEqual(plain(closing.revalidated), tagsFor('proj-open'));
  await closing.flush();
  assert.equal(closing.submitted.length, 1, 'the page that was indexable while open is announced after it closes');
  assert.equal(closing.submitted[0][0], `${SITE_URL}/projects/proj-open`);

  const hidden = routeSetup({ docs });
  assert.equal((await hidden.route.PATCH(closeRequest('proj-private'))).status, 200);
  assert.deepEqual(plain(hidden.revalidated), tagsFor('proj-private'), 'the caches are dropped');
  assert.equal(hidden.scheduled.length, 0, 'a project search engines never saw is not announced');

  for (const [label, request, status] of [
    ['a project that is already closed', closeRequest('proj-closed'), 200],
    ['a draft', closeRequest('proj-draft'), 409],
    ['someone else\'s project', closeRequest('proj-theirs'), 404],
    ['a missing project', closeRequest('proj-missing'), 404],
    ['an invalid request', json('PATCH', { slug: 'proj-open', status: 'open' }), 400],
  ]) {
    const unchanged = routeSetup({ docs });
    assert.equal((await unchanged.route.PATCH(request)).status, status, label);
    assert.equal(unchanged.revalidated.length, 0, `${label} expires nothing`);
    assert.equal(unchanged.scheduled.length, 0, `${label} announces nothing`);
  }
});

test('a transaction retry that finds the project already closed does not announce a closing it did not make', async () => {
  const harness = routeSetup({
    runTransaction: async (work) => {
      await work(transactionOver({ ...openProject }));
      return work(transactionOver({ ...openProject, status: 'closed' }));
    },
  });
  assert.equal((await harness.route.PATCH(json('PATCH', { slug: 'proj-open', status: 'closed' }))).status, 200);
  assert.equal(harness.revalidated.length, 0);
  assert.equal(harness.scheduled.length, 0);
});

// ---------------------------------------------------------------------------------------------
// The bulk submit script
// ---------------------------------------------------------------------------------------------

const escapeXml = (text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const urlset = (urls) => `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.map((url) => `<url><loc>${escapeXml(url)}</loc></url>`).join('')}</urlset>`;
const sitemapIndex = (urls) => `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.map((url) => `<sitemap><loc>${escapeXml(url)}</loc></sitemap>`).join('')}</sitemapindex>`;
const pages = (count) => Array.from({ length: count }, (_, index) => `${SITE_URL}/projects/p${index}`);

// A fake live site plus the IndexNow endpoint. `answers` are the endpoint's statuses, one per request.
function liveSite({ sitemap = urlset(pages(5)), sitemapStatus = 200, files = {}, keyStatus = 200, keyBody = KEY, key = KEY, answers = [], failPosts = false } = {}) {
  const posts = [];
  const gets = [];
  const fetch = async (url, init = {}) => {
    if (url === script.INDEXNOW_ENDPOINT) {
      posts.push({ init, payload: JSON.parse(init.body) });
      if (failPosts) throw new TypeError('fetch failed');
      return respond(answers[posts.length - 1] ?? 200);
    }
    gets.push({ url, init });
    if (url === `${SITE_URL}/sitemap.xml`) return new Response(sitemap, { status: sitemapStatus });
    if (url === `${SITE_URL}/${key}.txt`) return new Response(keyBody, { status: keyStatus });
    if (files[url] !== undefined) return new Response(files[url]);
    return new Response('missing', { status: 404 });
  };
  return { fetch, posts, gets };
}
async function runScript(argv, env, site) {
  const logs = [];
  const warnings = [];
  const code = await script.run(argv, env, { fetch: site.fetch, log: (line) => logs.push(line), warn: (line) => warnings.push(line) });
  return { code, logs, warnings, text: [...logs, ...warnings].join('\n') };
}
const siteEnv = { SITE_URL };

test('the script keeps its constants and key rule in step with src/lib/seo/indexnow.ts', () => {
  const module = indexnowFor();
  assert.equal(script.DEFAULT_INDEXNOW_KEY, module.DEFAULT_INDEXNOW_KEY);
  assert.equal(script.INDEXNOW_ENDPOINT, module.INDEXNOW_ENDPOINT);
  assert.equal(script.INDEXNOW_MAX_URLS, module.INDEXNOW_MAX_URLS);
  for (const INDEXNOW_KEY of [undefined, '', '  ', 'rotated-key-2027-abcdef', ' rotated-key-2027-abcdef ', 'short', 'a'.repeat(129), 'bad key with spaces']) {
    assert.equal(script.indexNowKey({ INDEXNOW_KEY }), module.indexNowKey({ INDEXNOW_KEY }), JSON.stringify(INDEXNOW_KEY));
  }
  const urls = [`${SITE_URL}/projects/a`, `${SITE_URL}/categories/design`];
  assert.deepEqual(plain(script.buildPayload(SITE_URL, KEY, urls)), plain(module.buildIndexNowPayload(urls)), 'the same payload as the server sends');
});

test('script arguments: defaults, flags and rejected values', () => {
  assert.deepEqual(script.parseArgs([]), { dryRun: false, batchSize: INDEXNOW_MAX_URLS, help: false });
  assert.deepEqual(script.parseArgs(['--dry-run', '--batch-size', '250']), { dryRun: true, batchSize: 250, help: false });
  assert.equal(script.parseArgs(['--batch-size=7']).batchSize, 7);
  assert.equal(script.parseArgs(['--batch-size', String(INDEXNOW_MAX_URLS)]).batchSize, INDEXNOW_MAX_URLS);
  assert.equal(script.parseArgs(['--help']).help, true);
  for (const bad of [['--batch-size'], ['--batch-size', '0'], ['--batch-size', '-1'], ['--batch-size', '1.5'], ['--batch-size', 'many'], ['--batch-size', String(INDEXNOW_MAX_URLS + 1)], ['--batch-size='], ['--unknown'], ['extra']]) {
    assert.throws(() => script.parseArgs(bad), (error) => error instanceof script.ScriptError && error.exitCode === 2, bad.join(' '));
  }
});

test('script origin: SITE_URL or NEXT_PUBLIC_SITE_URL is required and must be a plain HTTPS origin', () => {
  assert.equal(script.siteOrigin({ SITE_URL }), SITE_URL);
  assert.equal(script.siteOrigin({ SITE_URL: `${SITE_URL}/` }), SITE_URL);
  assert.equal(script.siteOrigin({ SITE_URL: `  ${SITE_URL.toUpperCase()}  ` }), SITE_URL);
  assert.equal(script.siteOrigin({ NEXT_PUBLIC_SITE_URL: SITE_URL }), SITE_URL);
  assert.equal(script.siteOrigin({ SITE_URL, NEXT_PUBLIC_SITE_URL: OTHER_HOST_URL }), SITE_URL, 'SITE_URL wins');
  for (const env of [{}, { SITE_URL: '' }, { SITE_URL: '   ' }, { SITE_URL: 'not a url' }, { SITE_URL: `http://${HOST}` }, { SITE_URL: `${SITE_URL}/path` }, { SITE_URL: `${SITE_URL}?q=1` }, { SITE_URL: `${SITE_URL}#top` }, { SITE_URL: `https://user:secret@${HOST}` }]) {
    assert.throws(() => script.siteOrigin(env), (error) => error instanceof script.ScriptError && error.exitCode === 2, JSON.stringify(env));
  }
});

test('script sitemap parsing keeps only same-origin, credential-free, de-duplicated URLs and splits them into batches', () => {
  const parsed = script.parseSitemap(`<urlset><url><loc> ${SITE_URL}/a?x=1&amp;y=2 </loc></url><url><loc>${SITE_URL}/b</loc></url><url><loc></loc></url><url><loc>${SITE_URL}/c&amp;lt;</loc></url></urlset>`);
  assert.equal(parsed.index, false);
  assert.deepEqual(parsed.locs, [`${SITE_URL}/a?x=1&y=2`, `${SITE_URL}/b`, `${SITE_URL}/c&lt;`], 'entities are decoded once and whitespace trimmed');
  assert.equal(script.parseSitemap(sitemapIndex([`${SITE_URL}/sitemap/0.xml`])).index, true);
  assert.deepEqual(script.parseSitemap('').locs, []);
  assert.deepEqual(script.selectUrls([
    `${SITE_URL}/a`, `${SITE_URL}/a#frag`, `${SITE_URL}/b`, `${OTHER_HOST_URL}/c`, `http://${HOST}/d`, `https://user:pw@${HOST}/e`, '/relative', 'nope', `${SITE_URL}/a`,
  ], SITE_URL), [`${SITE_URL}/a`, `${SITE_URL}/b`]);
  assert.deepEqual(script.chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  assert.deepEqual(script.chunk([], 3), []);
  assert.deepEqual(script.chunk([1, 2], 10), [[1, 2]]);
});

test('script submits the sitemap in batches to the endpoint with the protocol payload', async () => {
  const site = liveSite({ sitemap: urlset([...pages(5), `${OTHER_HOST_URL}/foreign`, `${SITE_URL}/projects/p0`, `${SITE_URL}/projects/p1#again`]), answers: [200, 202, 200] });
  const result = await runScript(['--batch-size', '2'], siteEnv, site);
  assert.equal(result.code, 0, result.text);
  assert.deepEqual(site.posts.map((post) => post.payload.urlList.length), [2, 2, 1]);
  assert.deepEqual(site.posts.flatMap((post) => post.payload.urlList), pages(5), 'every URL once, in sitemap order');
  for (const { init, payload } of site.posts) {
    assert.deepEqual(Object.keys(payload), ['host', 'key', 'keyLocation', 'urlList']);
    assert.equal(payload.host, HOST);
    assert.equal(payload.key, KEY);
    assert.equal(payload.keyLocation, `${SITE_URL}/${KEY}.txt`);
    assert.equal(init.method, 'POST');
    assert.equal(init.headers['Content-Type'], 'application/json; charset=utf-8');
    assert.equal(init.redirect, 'manual');
  }
  assert.deepEqual(site.gets.map((get) => get.url), [`${SITE_URL}/sitemap.xml`, `${SITE_URL}/${KEY}.txt`]);
  assert.deepEqual(result.warnings, []);
  assert.deepEqual(result.logs, [
    `Sitemap: 5 URLs on ${HOST}, 3 batches of up to 2.`,
    'Key file: live.',
    'Batch 1/3: 2 URLs, HTTP 200.', 'Batch 2/3: 2 URLs, HTTP 202.', 'Batch 3/3: 1 URLs, HTTP 200.',
    'Done: 5 URLs submitted.',
  ]);
  assert.equal(result.text.includes('/projects/p'), false, 'a real run prints counts and statuses, not URLs');

  // One request by default, and a configured key is used for the file check and the payload.
  const rotated = 'rotated-key-2027-abcdef';
  const single = liveSite({ key: rotated, keyBody: `${rotated}\n` });
  assert.equal((await runScript([], { NEXT_PUBLIC_SITE_URL: SITE_URL, INDEXNOW_KEY: rotated }, single)).code, 0);
  assert.equal(single.posts.length, 1);
  assert.equal(single.posts[0].payload.key, rotated);
  assert.equal(single.posts[0].payload.keyLocation, `${SITE_URL}/${rotated}.txt`);
});

test('script dry run reads the sitemap and the key file but sends nothing, even when the key is not live yet', async () => {
  const site = liveSite({ sitemap: urlset(pages(14)), keyStatus: 404 });
  const result = await runScript(['--dry-run'], siteEnv, site);
  assert.equal(result.code, 0, result.text);
  assert.equal(site.posts.length, 0);
  assert.equal(result.logs[0], `Sitemap: 14 URLs on ${HOST}, 1 batch of up to ${INDEXNOW_MAX_URLS}.`);
  assert.equal(result.logs[1], `Key file: NOT live at ${SITE_URL}/${KEY}.txt (it must answer 200 with the key).`);
  assert.deepEqual(result.logs.slice(2, 12), pages(10).map((url) => `  ${url}`), 'a sample of the URLs');
  assert.deepEqual(result.logs.slice(12), ['  ... and 4 more', 'Dry run: nothing was submitted.']);
  assert.deepEqual(result.warnings, []);
});

test('script stops at the first rejected batch and says how far it got', async () => {
  const hints = [[403, /key file is missing/], [422, /do not belong to the host/], [429, /too many requests/], [400, /malformed/], [500, /rejected the batch/]];
  for (const [status, hint] of hints) {
    const site = liveSite({ answers: [200, status, 200] });
    const result = await runScript(['--batch-size', '2'], siteEnv, site);
    assert.equal(result.code, 1, String(status));
    assert.equal(site.posts.length, 2, `no batch after the rejected one (${status})`);
    assert.match(result.warnings.join('\n'), hint);
    assert.match(result.warnings.join('\n'), /2 of 5 URLs were accepted/);
  }
  const unreachable = liveSite({ failPosts: true });
  const result = await runScript([], siteEnv, unreachable);
  assert.equal(result.code, 1);
  assert.deepEqual(result.warnings, ['Submission stopped. 0 of 5 URLs were accepted.']);
  assert.ok(result.logs.includes('Batch 1/1: 5 URLs, no response.'));
});

test('script refuses to submit when the key file is not live, the sitemap is unusable or the site is not configured', async () => {
  for (const [label, options] of [['a missing key file', { keyStatus: 404 }], ['a key file with another key', { keyBody: 'another-key-entirely' }], ['an empty key file', { keyBody: '' }]]) {
    const site = liveSite(options);
    const result = await runScript([], siteEnv, site);
    assert.equal(result.code, 1, label);
    assert.equal(site.posts.length, 0, label);
    assert.match(result.warnings.join('\n'), /deploy the key file first/, label);
  }
  for (const [label, options, message] of [
    ['an unavailable sitemap', { sitemapStatus: 503 }, /sitemap could not be read \(HTTP 503\)/],
    ['an empty sitemap', { sitemap: urlset([]) }, /nothing to submit/],
    ['a sitemap of foreign URLs only', { sitemap: urlset([`${OTHER_HOST_URL}/x`, `http://${HOST}/y`]) }, /nothing to submit/],
  ]) {
    const site = liveSite(options);
    const result = await runScript([], siteEnv, site);
    assert.equal(result.code, 1, label);
    assert.equal(site.posts.length, 0, label);
    assert.match(result.warnings.join('\n'), message, label);
  }
  const offline = { fetch: async () => { throw new TypeError('fetch failed'); }, posts: [] };
  const down = await runScript([], siteEnv, offline);
  assert.equal(down.code, 1);
  assert.deepEqual(down.warnings, ['The sitemap could not be read.']);

  for (const [argv, env] of [[[], {}], [['--dry-run'], { SITE_URL: `http://${HOST}` }], [['--bogus'], siteEnv]]) {
    const site = liveSite();
    const result = await runScript(argv, env, site);
    assert.equal(result.code, 2, `${argv} ${JSON.stringify(env)}`);
    assert.equal(site.gets.length + site.posts.length, 0, 'configuration errors make no request');
  }
});

test('script follows one level of sitemap index and rejects anything deeper', async () => {
  const first = `${SITE_URL}/sitemap/0.xml`;
  const second = `${SITE_URL}/sitemap/1.xml`;
  const site = liveSite({
    sitemap: sitemapIndex([first, second, `${OTHER_HOST_URL}/sitemap/2.xml`, first]),
    files: { [first]: urlset(pages(3)), [second]: urlset([...pages(5).slice(2), `${OTHER_HOST_URL}/z`]) },
  });
  const result = await runScript([], siteEnv, site);
  assert.equal(result.code, 0, result.text);
  assert.deepEqual(site.posts.flatMap((post) => post.payload.urlList), pages(5), 'both sitemaps, de-duplicated, same origin only');
  assert.deepEqual(site.gets.map((get) => get.url).slice(0, 3), [`${SITE_URL}/sitemap.xml`, first, second], 'the foreign child is never fetched');

  const nested = liveSite({ sitemap: sitemapIndex([first]), files: { [first]: sitemapIndex([second]) } });
  const rejected = await runScript([], siteEnv, nested);
  assert.equal(rejected.code, 1);
  assert.match(rejected.warnings.join('\n'), /Nested sitemap indexes are not supported/);

  const broken = liveSite({ sitemap: sitemapIndex([first]) });
  assert.match((await runScript([], siteEnv, broken)).warnings.join('\n'), /sitemap listed in the index could not be read \(HTTP 404\)/);

  const huge = liveSite({ sitemap: sitemapIndex(Array.from({ length: 51 }, (_, index) => `${SITE_URL}/sitemap/${index}.xml`)) });
  assert.match((await runScript([], siteEnv, huge)).warnings.join('\n'), /more than 50 sitemaps/);
  assert.equal(huge.gets.length, 1, 'no child sitemap is fetched when the index is too large');
});

test('script as a command: help and configuration errors work offline, with no site configured', () => {
  const command = (...argv) => spawnSync(process.execPath, [`${projectRoot}/scripts/indexnow-submit.mjs`, ...argv], { env: { PATH: process.env.PATH }, encoding: 'utf8', timeout: 20_000 });
  const help = command('--help');
  assert.equal(help.status, 0);
  assert.match(help.stdout, /^Usage: SITE_URL=<origin> node scripts\/indexnow-submit\.mjs/);
  const unconfigured = command('--dry-run');
  assert.equal(unconfigured.status, 2);
  assert.match(unconfigured.stderr, /SITE_URL/);
  assert.equal(unconfigured.stdout, '');
  assert.equal(command('--nope').status, 2);
});

// ---------------------------------------------------------------------------------------------
// Wiring and hygiene
// ---------------------------------------------------------------------------------------------

test('the script is wired into package.json and the optional key is documented in .env.example', () => {
  const manifest = JSON.parse(readFileSync(`${projectRoot}/package.json`, 'utf8'));
  assert.equal(manifest.scripts['seo:indexnow'], 'node scripts/indexnow-submit.mjs');
  const env = readFileSync(`${projectRoot}/.env.example`, 'utf8');
  assert.match(env, /^# .*IndexNow.*\n^INDEXNOW_KEY=$/m, 'a one-line comment and an empty default');
  assert.match(env, /^AI_TRAINING_CRAWLERS=allow$/m);
});

test('IndexNow code takes the origin from site.ts or the environment and hard-codes no host except the IndexNow service', () => {
  const services = new Set(['api.indexnow.org', 'www.indexnow.org']);
  for (const file of ['src/lib/seo/indexnow.ts', 'src/lib/projects/events.ts', 'src/app/api/marketplace/projects/route.ts', 'scripts/indexnow-submit.mjs']) {
    const source = readFileSync(`${projectRoot}/${file}`, 'utf8');
    assert.doesNotMatch(source, /freelance-place|localhost|127\.0\.0\.1|\.run\.app/i, file);
    for (const [, host] of source.matchAll(/https?:\/\/([^\s/'"`)<>]+)/g)) assert.ok(services.has(host), `${file} mentions ${host}`);
  }
});
