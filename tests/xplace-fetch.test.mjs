import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { loadModule } from './helpers/load-ts.mjs';

// ---- fake Firestore: one in-memory document map with transaction semantics ----
function fakeFirestore() {
  const docs = new Map();
  const ref = (id) => ({ id });
  const db = {
    collection: (name) => ({ doc: (id) => ref(`${name}/${id}`) }),
    runTransaction: async (fn) => fn({
      get: async (r) => ({ get: (field) => docs.get(r.id)?.[field] }),
      set: (r, data) => { docs.set(r.id, data); },
    }),
  };
  return { db, docs };
}

function loadThrottle(fake) {
  return loadModule('src/lib/imports/host-throttle.ts', { stubs: {
    'node:crypto': { createHash },
    '@/lib/db/firestore': { firestore: () => fake.db },
    'firebase-admin/firestore': { Timestamp: { fromMillis: (ms) => ({ ms }) } },
  } });
}

function loadFetch() {
  return loadModule('src/lib/imports/safe-fetch.ts', { stubs: {
    'node:crypto': { createHash },
    '@/lib/db/firestore': { firestore: () => { throw new Error('Firestore must not be used'); } },
    'firebase-admin/firestore': { Timestamp: {} },
    '@/lib/seo/site': { SITE_URL: 'https://freelance-place.com' },
  } });
}

const URL_OK = 'https://www.xplace.com/project?id=123456';
const html = (body = '<html>ok</html>', type = 'text/html; charset=utf-8', status = 200) =>
  new Response(body, { status, headers: { 'content-type': type } });
const redirect = (location, status = 302) => new Response(null, { status, headers: location === undefined ? {} : { location } });

function harness(responses) {
  const calls = [];
  const slots = [];
  const queue = [...responses];
  return {
    calls, slots,
    deps: {
      fetch: async (url, init) => {
        calls.push({ url, init });
        const next = queue.shift();
        if (next instanceof Error) throw next;
        return typeof next === 'function' ? next() : next;
      },
      acquireSlot: async (host) => { slots.push(host); },
    },
  };
}

async function quiet(fn) {
  const original = console.info;
  const lines = [];
  console.info = (line) => lines.push(line);
  try { return await fn(lines); } finally { console.info = original; }
}

test('fetch: returns the decoded UTF-8 body with identifying headers and no credentials', async () => {
  const { safeFetchHtml } = loadFetch();
  const h = harness([html('שלום <b>world</b>')]);
  const body = await quiet(() => safeFetchHtml(URL_OK, h.deps));
  assert.equal(body, 'שלום <b>world</b>');
  assert.equal(h.calls.length, 1);
  const { url, init } = h.calls[0];
  assert.equal(url, URL_OK);
  assert.equal(init.redirect, 'manual');
  assert.equal(init.cache, 'no-store');
  assert.equal(init.headers['User-Agent'], 'FreelancePlaceImporter/1.0 (+https://freelance-place.com)');
  assert.equal(init.headers.Accept, 'text/html');
  assert.equal(init.headers['Accept-Language'], 'he,en;q=0.8');
  const names = Object.keys(init.headers).map((name) => name.toLowerCase());
  assert.ok(!names.includes('cookie') && !names.includes('authorization'));
  assert.equal(init.credentials, undefined);
  assert.ok(init.signal, 'timeout signal');
  assert.deepEqual(h.slots, ['www.xplace.com']);
});

test('fetch: acquires one slot per network request, including redirects', async () => {
  const { safeFetchHtml } = loadFetch();
  const h = harness([redirect('/il/job-bids/123456', 301), redirect('https://xplace.com/final', 302), html()]);
  await quiet(() => safeFetchHtml(URL_OK, h.deps));
  assert.deepEqual(h.slots, ['www.xplace.com', 'www.xplace.com', 'xplace.com']);
  assert.deepEqual(h.calls.map((call) => call.url), [URL_OK, 'https://www.xplace.com/il/job-bids/123456', 'https://xplace.com/final']);
});

test('fetch: rejects a start URL outside the allowlist before any request', async () => {
  const { safeFetchHtml } = loadFetch();
  for (const bad of ['http://www.xplace.com/x', 'https://evil.com/', 'https://www.xplace.com.evil.com/', 'https://user:pw@www.xplace.com/', 'https://www.xplace.com:8443/', 'not a url']) {
    const h = harness([html()]);
    await assert.rejects(quiet(() => safeFetchHtml(bad, h.deps)), { code: 'UPSTREAM_UNAVAILABLE' }, bad);
    assert.equal(h.calls.length, 0);
    assert.equal(h.slots.length, 0);
  }
});

test('fetch: redirects to a foreign host, http, credentials or ports are rejected', async () => {
  const { safeFetchHtml } = loadFetch();
  for (const location of ['https://evil.com/', 'http://www.xplace.com/', 'https://www.xplace.com.evil.com/', 'https://u:p@www.xplace.com/', 'https://www.xplace.com:444/', '//evil.com/x']) {
    const h = harness([redirect(location), html()]);
    await assert.rejects(quiet(() => safeFetchHtml(URL_OK, h.deps)), { code: 'UPSTREAM_UNAVAILABLE' }, location);
    assert.equal(h.calls.length, 1, `no request to ${location}`);
  }
  const missing = harness([redirect(undefined), html()]);
  await assert.rejects(quiet(() => safeFetchHtml(URL_OK, missing.deps)), { code: 'UPSTREAM_UNAVAILABLE' });
});

test('fetch: more than two redirects fail, exactly two succeed', async () => {
  const { safeFetchHtml } = loadFetch();
  const three = harness([redirect('/a'), redirect('/b'), redirect('/c'), html()]);
  await assert.rejects(quiet(() => safeFetchHtml(URL_OK, three.deps)), { code: 'UPSTREAM_UNAVAILABLE' });
  assert.equal(three.calls.length, 3);
  const two = harness([redirect('/a'), redirect('/b'), html('done')]);
  assert.equal(await quiet(() => safeFetchHtml(URL_OK, two.deps)), 'done');
});

test('fetch: oversize bodies are aborted (declared and streamed)', async () => {
  const { safeFetchHtml } = loadFetch();
  const declared = harness([new Response('x', { status: 200, headers: { 'content-type': 'text/html', 'content-length': String(3 * 1024 * 1024) } })]);
  await assert.rejects(quiet(() => safeFetchHtml(URL_OK, declared.deps)), { code: 'UPSTREAM_UNAVAILABLE' });

  let cancelled = false;
  let sent = 0;
  const stream = new ReadableStream({
    pull(controller) { sent += 512 * 1024; controller.enqueue(new Uint8Array(512 * 1024)); },
    cancel() { cancelled = true; },
  });
  const streamed = harness([new Response(stream, { status: 200, headers: { 'content-type': 'text/html' } })]);
  await assert.rejects(quiet(() => safeFetchHtml(URL_OK, streamed.deps)), { code: 'UPSTREAM_UNAVAILABLE' });
  assert.ok(cancelled, 'stream was cancelled');
  assert.ok(sent <= 4 * 1024 * 1024 + 512 * 1024, 'stopped reading shortly after the cap');

  const exactlyUnder = harness([html('a'.repeat(2 * 1024 * 1024))]);
  assert.equal((await quiet(() => safeFetchHtml(URL_OK, exactlyUnder.deps))).length, 2 * 1024 * 1024);
});

test('fetch: non-HTML content types are rejected', async () => {
  const { safeFetchHtml } = loadFetch();
  for (const type of ['application/json', 'application/pdf', 'text/plain', '']) {
    const h = harness([new Response('{}', { status: 200, headers: type ? { 'content-type': type } : {} })]);
    await assert.rejects(quiet(() => safeFetchHtml(URL_OK, h.deps)), { code: 'UPSTREAM_UNAVAILABLE' }, type);
  }
});

test('fetch: status mapping', async () => {
  const { safeFetchHtml } = loadFetch();
  const expect = async (status, code) => {
    const h = harness([html('x', 'text/html', status)]);
    await assert.rejects(quiet(() => safeFetchHtml(URL_OK, h.deps)), { code }, String(status));
  };
  await expect(404, 'NOT_FOUND');
  await expect(410, 'NOT_FOUND');
  for (const status of [403, 429, 500, 502, 503, 201]) await expect(status, 'UPSTREAM_UNAVAILABLE');
});

test('fetch: network errors and timeouts are UPSTREAM_UNAVAILABLE', async () => {
  const { safeFetchHtml } = loadFetch();
  for (const error of [new TypeError('fetch failed'), Object.assign(new Error('timeout'), { name: 'TimeoutError' })]) {
    const h = harness([error]);
    await assert.rejects(quiet(() => safeFetchHtml(URL_OK, h.deps)), { code: 'UPSTREAM_UNAVAILABLE' });
  }
});

test('fetch: a throttle rejection propagates and no request is made', async () => {
  const { safeFetchHtml } = loadFetch();
  const { ImportError } = loadModule('src/lib/imports/errors.ts');
  const h = harness([html()]);
  const deps = { ...h.deps, acquireSlot: async () => { throw new ImportError('RATE_LIMITED', 9); } };
  await assert.rejects(quiet(() => safeFetchHtml(URL_OK, deps)), { code: 'RATE_LIMITED', retryAfterSeconds: 9 });
  assert.equal(h.calls.length, 0);
});

test('fetch: logs one JSON line with a hash of the URL, never the URL', async () => {
  const { safeFetchHtml } = loadFetch();
  const h = harness([html()]);
  const lines = [];
  await quiet(async (captured) => { await safeFetchHtml(URL_OK, h.deps); lines.push(...captured); });
  assert.equal(lines.length, 1);
  const entry = JSON.parse(lines[0]);
  assert.equal(entry.event, 'xplace_fetch');
  assert.equal(entry.status, 200);
  assert.equal(entry.urlSha256, createHash('sha256').update(URL_OK).digest('hex'));
  assert.equal(typeof entry.durationMs, 'number');
  assert.ok(!lines[0].includes('xplace.com') && !lines[0].includes('123456'));
});

// ---- host throttle ----
function clock(start = 1_000_000) {
  const state = { now: start, slept: [] };
  return { state, now: () => state.now, sleep: async (ms) => { state.slept.push(ms); state.now += ms; } };
}

test('throttle: first caller waits 0, the next waits one spacing, state is keyed by a host hash', async () => {
  const fake = fakeFirestore();
  const { acquireHostSlot } = loadThrottle(fake);
  const c = clock();
  const options = { now: c.now, sleep: async (ms) => { c.state.slept.push(ms); } };
  await acquireHostSlot('www.xplace.com', options);
  await acquireHostSlot('www.xplace.com', options);
  assert.deepEqual(c.state.slept, [0, 10_000]);
  const [[id, doc]] = [...fake.docs.entries()];
  assert.equal(id, `securityRateLimits/${createHash('sha256').update(JSON.stringify(['host', 'www.xplace.com'])).digest('hex')}`);
  assert.equal(doc.nextSlotAt, 1_000_000 + 20_000);
  assert.equal(doc.expiresAt.ms, 1_000_000 + 20_000 + 60_000);
});

test('throttle: after the spacing has passed the next caller does not wait', async () => {
  const fake = fakeFirestore();
  const { acquireHostSlot } = loadThrottle(fake);
  const c = clock();
  await acquireHostSlot('www.xplace.com', c);
  c.state.now += 30_000;
  await acquireHostSlot('www.xplace.com', c);
  assert.deepEqual(c.state.slept, [0, 0]);
});

test('throttle: a caller that would wait beyond maxWaitMs gets RATE_LIMITED without reserving', async () => {
  const fake = fakeFirestore();
  const { acquireHostSlot } = loadThrottle(fake);
  const c = clock();
  const options = { now: c.now, sleep: async (ms) => { c.state.slept.push(ms); } };
  await acquireHostSlot('h', options); // slot at +0, next at +10s
  await acquireHostSlot('h', options); // slot at +10s (wait 10s <= 15s), next at +20s
  const before = structuredClone([...fake.docs.values()][0].nextSlotAt);
  await assert.rejects(acquireHostSlot('h', options), (error) => error.code === 'RATE_LIMITED' && error.retryAfterSeconds === 20);
  assert.equal([...fake.docs.values()][0].nextSlotAt, before, 'nothing was reserved');
  assert.deepEqual(c.state.slept, [0, 10_000]);
  // Time passes and the next caller is admitted again.
  c.state.now += 10_000;
  await acquireHostSlot('h', options);
  assert.equal(c.state.slept.length, 3);
});

test('throttle: different hosts use independent documents; options override defaults', async () => {
  const fake = fakeFirestore();
  const { acquireHostSlot } = loadThrottle(fake);
  const c = clock();
  const options = { now: c.now, sleep: async (ms) => { c.state.slept.push(ms); }, spacingMs: 2000, maxWaitMs: 1000 };
  await acquireHostSlot('a', options);
  await acquireHostSlot('b', options);
  assert.equal(fake.docs.size, 2);
  assert.deepEqual(c.state.slept, [0, 0]);
  await assert.rejects(acquireHostSlot('a', options), { code: 'RATE_LIMITED' });
});
