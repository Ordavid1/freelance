import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server.js';
import { loadModule } from './helpers/load-ts.mjs';
import { createFakeFirestore, DELETE_FIELD } from './helpers/fake-firestore.mjs';

// WP2: data layer and API of the headhunter feature, over the in-memory Firestore and stubbed Next.js / auth.

const SITE = 'https://freelance-place.com';
const urls = loadModule('src/lib/headhunters/urls.ts', { env: { NEXT_PUBLIC_SITE_URL: SITE } });
const owner = { uid: 'owner-1', name: 'Owner', email: 'owner@example.test' };
const DAY = 24 * 60 * 60 * 1000;
const LONG = 'תיאור מפורט של הפרויקט הנדרש ';

const form = (extra = {}) => ({
  displayName: 'Acme Recruiting', kind: 'agency', city: 'Tel Aviv', tagline: 'We place developers',
  contact: { email: 'jobs@acme.example', website: 'https://acme.example' }, attested: true, handle: 'acme-hr', ...extra,
});
// Countable projects have unique text of 80+ characters (a duplicate or short description does not count).
const project = (index, extra = {}) => ({ title: `Project number ${index}`, description: `${LONG}${index} `.repeat(4), ownerUid: owner.uid, status: 'open', ...extra });
const projects = (count, ownerUid = owner.uid) => Object.fromEntries(Array.from({ length: count }, (_, index) => [`p-${ownerUid}-${index}`, project(index, { ownerUid })]));
const record = (extra = {}) => ({
  ownerUid: owner.uid, status: 'draft', displayName: 'Acme Recruiting', handle: 'acme-hr', kind: 'agency', contact: { email: 'jobs@acme.example' },
  counters: { published: 0 }, flags: [], version: 1, ...extra,
});
const { handleSkeleton } = loadModule('src/lib/headhunters/handle.ts');
const handleDoc = (handle, ownerUid, extra = {}) => ({ handle, ownerUid, state: 'active', skeleton: handleSkeleton(handle), ...extra });
const open = { config: { headhunters: { enabled: true, applicationsOpen: true } } };

function world({ seed = {}, user = owner, moderator = null, env = {} } = {}) {
  const db = createFakeFirestore({ ...open, ...seed });
  const state = { user, moderator, sameOrigin: true, limit: null, denied: null, limitCalls: [], revalidated: [], reads: 0 };
  let slug = 0;
  const stubs = {
    'next/server': { NextResponse },
    'next/cache': { unstable_cache: (fn) => fn, revalidateTag: (tag) => state.revalidated.push(tag) },
    'node:crypto': { createHash, randomUUID: () => `slug-${++slug}` },
    'firebase-admin/firestore': { FieldValue: { serverTimestamp: () => 'SERVER_TS', delete: () => DELETE_FIELD }, FieldPath: {} },
    '@/lib/auth/session': { getCurrentUser: async () => state.user, isSameOrigin: () => state.sameOrigin },
    '@/lib/db/firestore': { firestore: () => db },
    '@/lib/security/rate-limit': { enforceActionLimit: async (...args) => { state.limitCalls.push(args); return state.limit; } },
    '@/lib/security/marketplace-policy': {
      accountWriteDenied: async () => state.denied,
      accountState: (value) => (value === undefined || value === 'active' ? 'active' : value === 'restricted' ? 'restricted' : 'suspended'),
      assertContactAllowed: async () => {}, ContactUnavailable: class extends Error {},
    },
    '@/lib/security/moderator': { moderatorUid: async () => state.moderator },
    '@/lib/projects/events': { onProjectPublished: () => {}, onProjectClosed: () => {} },
    '@/lib/db/projects': { listFeedProjects: async () => [], toPublicProject: (id, data) => ({ slug: id, title: data.title }) },
  };
  const load = (file) => loadModule(file, { stubs, env: { NEXT_PUBLIC_SITE_URL: SITE, XPLACE_IMPORT_ENABLED: 'true', ...env } });
  return { db, state, load, routes: {
    headhunter: () => load('src/app/api/headhunter/route.ts'),
    handle: () => load('src/app/api/headhunter/handle/route.ts'),
    moderation: () => load('src/app/api/moderation/headhunters/route.ts'),
    projects: () => load('src/app/api/marketplace/projects/route.ts'),
    data: () => load('src/lib/db/headhunters.ts'),
  } };
}
const call = (route, method, path, body) => route[method](new Request(`${SITE}${path}`, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }));
const withLimits = (state) => state.limitCalls.map((args) => args[1]);
const audits = (db) => Object.values(db.docs('securityAuditEvents'));

// ---------------------------------------------------------------------------------------------
// The feature switch
// ---------------------------------------------------------------------------------------------

test('feature switch off (config missing, or enabled false): every headhunter route is a 404 and nothing is read or written', async () => {
  for (const seed of [{ config: {} }, { config: { headhunters: { enabled: false, applicationsOpen: true } } }, { config: { headhunters: { enabled: 'true' } } }]) {
    const w = world({ seed });
    const hh = w.routes.headhunter();
    const handle = w.routes.handle();
    const responses = [
      await call(hh, 'GET', '/api/headhunter'), await call(hh, 'POST', '/api/headhunter', form()), await call(hh, 'PATCH', '/api/headhunter', { tagline: 'x' }),
      await call(handle, 'GET', '/api/headhunter/handle?handle=acme-hr'), await call(handle, 'POST', '/api/headhunter/handle', { handle: 'acme-hr' }),
    ];
    for (const response of responses) assert.equal(response.status, 404, JSON.stringify(seed));
    assert.equal(w.db.writes.length, 0);
    assert.equal(w.state.limitCalls.length, 0, 'the gate comes before the rate limiter');
  }
});

test('the config document is read as { enabled, applicationsOpen }, both false when missing; closed applications refuse only applying', async () => {
  const data = world({ seed: { config: {} } }).routes.data();
  assert.deepEqual({ ...await data.getHeadhunterConfig() }, { enabled: false, applicationsOpen: false });
  const w = world({ seed: { config: { headhunters: { enabled: true, applicationsOpen: false } } } });
  assert.deepEqual({ ...await w.routes.data().getHeadhunterConfig() }, { enabled: true, applicationsOpen: false });
  const hh = w.routes.headhunter();
  const applied = await call(hh, 'POST', '/api/headhunter', form());
  assert.equal(applied.status, 403);
  assert.equal((await applied.json()).code, 'APPLICATIONS_CLOSED');
  assert.equal((await call(hh, 'GET', '/api/headhunter')).status, 200);
  assert.equal(w.db.writes.length, 0);
});

test('a config read failure fails closed with 503', async () => {
  const w = world();
  w.db.collection = () => ({ doc: () => ({ get: async () => { throw new Error('down'); } }) });
  assert.equal((await call(w.routes.headhunter(), 'GET', '/api/headhunter')).status, 503);
});

// ---------------------------------------------------------------------------------------------
// Apply
// ---------------------------------------------------------------------------------------------

test('apply: origin, session, rate limit and account checks come first; the body is not read when limited', async () => {
  const w = world();
  const route = w.routes.headhunter();
  w.state.sameOrigin = false;
  assert.equal((await call(route, 'POST', '/api/headhunter', form())).status, 403);
  w.state.sameOrigin = true; w.state.user = null;
  assert.equal((await call(route, 'POST', '/api/headhunter', form())).status, 401);
  w.state.user = owner; w.state.limit = Response.json({ code: 'RATE_LIMITED' }, { status: 429 });
  const request = new Request(`${SITE}/api/headhunter`, { method: 'POST', body: '{unread' });
  assert.equal((await route.POST(request)).status, 429);
  assert.equal(request.bodyUsed, false);
  assert.deepEqual(withLimits(w.state), ['headhunter.edit']);
  w.state.limit = null; w.state.denied = Response.json({ code: 'ACCOUNT_RESTRICTED' }, { status: 403 });
  assert.equal((await call(route, 'POST', '/api/headhunter', form())).status, 403);
  w.state.denied = null;
  assert.equal((await route.POST(new Request(`${SITE}/api/headhunter`, { method: 'POST', body: JSON.stringify({ pad: 'x'.repeat(9000) }) }))).status, 413);
  assert.equal(w.db.writes.length, 0);
});

test('apply validates the fields, requires the attestation and a valid, unreserved handle', async () => {
  const bad = [
    [form({ attested: undefined }), 'ATTESTATION_REQUIRED'], [form({ attested: 'true' }), 'ATTESTATION_REQUIRED'],
    [form({ displayName: 'x' }), 'DISPLAY_NAME_INVALID'], [form({ kind: 'bank' }), 'KIND_INVALID'], [form({ contact: {} }), 'CONTACT_REQUIRED'],
    [form({ tagline: 'see https://spam.example' }), 'LINKS_NOT_ALLOWED'], [form({ role: 'admin' }), 'UNKNOWN_FIELD'],
    [form({ handle: 'Ab' }), 'FORMAT'], [form({ handle: undefined }), 'FORMAT'], [form({ handle: 'admin' }), 'RESERVED'], [form({ handle: 'xp1ace-jobs' }), 'RESERVED'],
  ];
  for (const [body, code] of bad) {
    const w = world();
    const response = await call(w.routes.headhunter(), 'POST', '/api/headhunter', body);
    assert.equal(response.status, 400, code);
    assert.equal((await response.json()).code, code);
    assert.equal(w.db.writes.length, 0, `${code} writes nothing`);
  }
});

test('apply creates a draft record and claims the handle (with its skeleton) in one transaction; the cache is dropped', async () => {
  const w = world({ seed: { projects: projects(3) } });
  const response = await call(w.routes.headhunter(), 'POST', '/api/headhunter', form());
  assert.equal(response.status, 201);
  const body = await response.json();
  assert.deepEqual({ status: body.status, handle: body.handle, published: body.published, required: body.required }, { status: 'draft', handle: 'acme-hr', published: 3, required: 10 });
  const stored = w.db.docs('headhunters')[owner.uid];
  assert.equal(stored.status, 'draft');
  assert.equal(stored.handle, 'acme-hr');
  assert.deepEqual({ ...stored.counters }, { published: 3 });
  assert.equal(stored.eligibleAt, undefined);
  assert.equal(stored.attestedAt, 'SERVER_TS');
  assert.equal(stored.version, 1);
  assert.equal(stored.attested, undefined, 'the attestation flag itself is not stored');
  assert.deepEqual({ ...w.db.docs('handles')['acme-hr'] }, { handle: 'acme-hr', ownerUid: owner.uid, state: 'active', skeleton: 'acmehr', createdAt: 'SERVER_TS' });
  assert.deepEqual(w.db.writes.map((write) => write.collection).sort(), ['handles', 'headhunters'], 'only the two documents of the claim');
  assert.deepEqual(w.state.revalidated, ['headhunters', 'headhunter:acme-hr']);
  assert.deepEqual(withLimits(w.state), ['headhunter.edit']);
  assert.equal((await call(w.routes.headhunter(), 'POST', '/api/headhunter', form({ handle: 'other-name' }))).status, 409, 'one record per account');
});

test('apply initialises the counter from existing projects: only countable ones count, and 10 makes it a review request', async () => {
  const extras = {
    short: project(900, { description: 'Twenty-plus characters but under eighty.' }),
    sample: project(901, { sample: true }), ai: project(902, { owner: { kind: 'ai-agent' } }), archived: project(903, { status: 'archived' }),
    duplicate: project(0, { title: 'Project number 0' }), other: project(904, { ownerUid: 'someone-else' }),
  };
  const seven = world({ seed: { projects: { ...projects(7), ...extras } } });
  await call(seven.routes.headhunter(), 'POST', '/api/headhunter', form());
  assert.equal(seven.db.docs('headhunters')[owner.uid].counters.published, 7);
  assert.equal(seven.db.docs('headhunters')[owner.uid].status, 'draft');

  const ten = world({ seed: { projects: projects(10) } });
  const response = await call(ten.routes.headhunter(), 'POST', '/api/headhunter', form());
  assert.equal((await response.json()).status, 'pending');
  const stored = ten.db.docs('headhunters')[owner.uid];
  assert.equal(stored.status, 'pending');
  assert.equal(stored.eligibleAt, 'SERVER_TS');
});

test('a watched-brand handle is accepted and flagged for review', async () => {
  const w = world();
  assert.equal((await call(w.routes.headhunter(), 'POST', '/api/headhunter', form({ handle: 'google-recruiting' }))).status, 201);
  assert.deepEqual([...w.db.docs('headhunters')[owner.uid].flags], ['lookalike:google']);
});

// ---------------------------------------------------------------------------------------------
// Handle claims
// ---------------------------------------------------------------------------------------------

test('a taken handle (any state) or a look-alike of someone else\'s handle is refused with one message that does not say why', async () => {
  const seed = { handles: {
    'acme-hr': handleDoc('acme-hr', 'rival'),
    'old-agency': handleDoc('old-agency', 'rival', { state: 'retired', pointsTo: 'acme-hr' }),
    'nexus-jobs': handleDoc('nexus-jobs', 'rival'),
  } };
  const messages = new Set();
  for (const handle of ['acme-hr', 'old-agency', 'acm3-hr', 'nexus-j0bs', 'ne-xus-jobs']) {
    const w = world({ seed });
    const response = await call(w.routes.headhunter(), 'POST', '/api/headhunter', form({ handle }));
    assert.equal(response.status, 409, handle);
    const body = await response.json();
    assert.equal(body.code, 'HANDLE_TAKEN');
    messages.add(body.error);
    assert.equal(w.db.writes.length, 0, handle);
    assert.equal(w.db.docs('headhunters')[owner.uid], undefined);
  }
  assert.equal(messages.size, 1);
  // The same owner's look-alike is fine (only someone else's block it).
  const own = world({ seed: { handles: { 'acme-hr': handleDoc('acme-hr', owner.uid, { state: 'retired' }) } } });
  assert.equal((await call(own.routes.headhunter(), 'POST', '/api/headhunter', form({ handle: 'acm3-hr' }))).status, 201);
});

test('two accounts claiming the same handle at once: exactly one wins, and the other changes nothing', async () => {
  const w = world();
  const first = w.routes.headhunter();
  const second = w.routes.headhunter();
  const other = { uid: 'owner-2', name: 'Two', email: 'two@example.test' };
  const users = [owner, other];
  let turn = 0;
  w.state.user = null;
  Object.defineProperty(w.state, 'user', { get: () => users[turn++ % 2], configurable: true });
  const results = await Promise.all([call(first, 'POST', '/api/headhunter', form()), call(second, 'POST', '/api/headhunter', form({ displayName: 'Other Agency' }))]);
  assert.deepEqual(results.map((response) => response.status).sort(), [201, 409]);
  assert.equal(Object.keys(w.db.docs('handles')).length, 1);
  assert.equal(Object.keys(w.db.docs('headhunters')).length, 1);
  const winner = w.db.docs('handles')['acme-hr'].ownerUid;
  assert.ok(w.db.docs('headhunters')[winner]);
});

test('availability: format, reserved, taken and free; no owner leaks; it spends the handle budget', async () => {
  const w = world({ seed: { handles: { 'acme-hr': handleDoc('acme-hr', 'rival'), 'gone-hr': handleDoc('gone-hr', 'rival', { state: 'retired', pointsTo: 'acme-hr' }) } } });
  const route = w.routes.handle();
  const check = async (handle) => (await call(route, 'GET', `/api/headhunter/handle?handle=${encodeURIComponent(handle)}`)).json();
  assert.equal((await check('x')).code, 'FORMAT');
  assert.equal((await check('admin')).code, 'RESERVED');
  const taken = await check('acme-hr');
  assert.deepEqual({ available: taken.available, code: taken.code }, { available: false, code: 'HANDLE_TAKEN' });
  assert.deepEqual(await check('gone-hr'), taken, 'a retired handle looks the same as an active one');
  assert.deepEqual(await check('acm3-hr'), taken, 'and so does a look-alike');
  assert.doesNotMatch(JSON.stringify(taken), /rival|owner|retired|pointsTo/);
  assert.deepEqual(await check('Fresh-Name'), { available: true, handle: 'fresh-name' });
  assert.deepEqual(withLimits(w.state), Array(6).fill('headhunter.handle'));
  w.state.user = null;
  assert.equal((await call(route, 'GET', '/api/headhunter/handle?handle=fresh-name')).status, 401);
  w.state.user = owner; w.state.limit = Response.json({ code: 'RATE_LIMITED' }, { status: 429 });
  assert.equal((await call(route, 'GET', '/api/headhunter/handle?handle=fresh-name')).status, 429);
  assert.equal(w.db.writes.length, 0);
});

// ---------------------------------------------------------------------------------------------
// Rename
// ---------------------------------------------------------------------------------------------

const withRecord = (extra = {}, handles = {}) => ({
  headhunters: { [owner.uid]: record({ status: 'approved', eligibleAt: 1, approvedAt: 1, counters: { published: 12 }, ...extra }) },
  handles: { 'acme-hr': handleDoc('acme-hr', owner.uid), ...handles },
});
const rename = (w, handle) => call(w.routes.handle(), 'POST', '/api/headhunter/handle', { handle });

test('rename: one transaction retires the old handle with pointsTo, claims the new one and updates the record; both URLs are invalidated', async () => {
  const w = world({ seed: withRecord() });
  const response = await rename(w, 'acme-recruiting');
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, handle: 'acme-recruiting', status: 'approved' });
  const handles = w.db.docs('handles');
  assert.deepEqual({ state: handles['acme-hr'].state, pointsTo: handles['acme-hr'].pointsTo }, { state: 'retired', pointsTo: 'acme-recruiting' });
  assert.deepEqual({ state: handles['acme-recruiting'].state, owner: handles['acme-recruiting'].ownerUid, skeleton: handles['acme-recruiting'].skeleton }, { state: 'active', owner: owner.uid, skeleton: 'acmerecruiting' });
  const stored = w.db.docs('headhunters')[owner.uid];
  assert.equal(stored.handle, 'acme-recruiting');
  assert.equal(stored.version, 2);
  assert.ok(stored.renamedAt);
  assert.deepEqual(w.state.revalidated.sort(), ['headhunter:acme-hr', 'headhunter:acme-recruiting', 'headhunters', 'headhunters']);
  assert.deepEqual(withLimits(w.state), ['headhunter.handle']);
});

test('rename cooldown: a second rename inside 30 days is refused; after 30 days it works', async () => {
  const w = world({ seed: withRecord() });
  assert.equal((await rename(w, 'acme-two')).status, 200);
  const early = await rename(w, 'acme-three');
  assert.equal(early.status, 429);
  const body = await early.json();
  assert.equal(body.code, 'RENAME_COOLDOWN');
  assert.ok(body.retryAfterDays >= 29 && body.retryAfterDays <= 30);
  assert.equal(w.db.docs('headhunters')[owner.uid].handle, 'acme-two');
  w.db.docs('headhunters')[owner.uid].renamedAt = new Date(Date.now() - 31 * DAY);
  assert.equal((await rename(w, 'acme-three')).status, 200);
  assert.equal(w.db.docs('headhunters')[owner.uid].handle, 'acme-three');
});

test('rename keeps every redirect one hop: all retired handles of the owner point at the current handle', async () => {
  const w = world({ seed: withRecord() });
  const backdate = () => { w.db.docs('headhunters')[owner.uid].renamedAt = new Date(Date.now() - 31 * DAY); };
  assert.equal((await rename(w, 'acme-b')).status, 200); backdate();
  assert.equal((await rename(w, 'acme-c')).status, 200); backdate();
  const handles = w.db.docs('handles');
  assert.deepEqual(['acme-hr', 'acme-b'].map((name) => [handles[name].state, handles[name].pointsTo]), [['retired', 'acme-c'], ['retired', 'acme-c']]);
  assert.equal(handles['acme-c'].state, 'active');
  // Taking an old handle of your own back reactivates it and repoints the others.
  assert.equal((await rename(w, 'acme-hr')).status, 200);
  const after = w.db.docs('handles');
  assert.deepEqual({ ...after['acme-hr'] }.pointsTo, undefined);
  assert.equal(after['acme-hr'].state, 'active');
  assert.deepEqual(['acme-b', 'acme-c'].map((name) => [after[name].state, after[name].pointsTo]), [['retired', 'acme-hr'], ['retired', 'acme-hr']]);
  assert.equal(w.db.docs('headhunters')[owner.uid].handle, 'acme-hr');
});

test('a retired handle of another owner is never reassignable, and neither are taken, look-alike or reserved ones', async () => {
  const seed = withRecord({}, { 'rival-hr': handleDoc('rival-hr', 'rival', { state: 'retired', pointsTo: 'rival-two' }), 'rival-two': handleDoc('rival-two', 'rival') });
  for (const [handle, status, code] of [['rival-hr', 409, 'HANDLE_TAKEN'], ['rival-two', 409, 'HANDLE_TAKEN'], ['r1val-hr', 409, 'HANDLE_TAKEN'], ['admin', 400, 'RESERVED'], ['acme-hr', 409, 'HANDLE_SAME'], ['No', 400, 'FORMAT']]) {
    const w = world({ seed });
    const response = await rename(w, handle);
    assert.equal(response.status, status, handle);
    assert.equal((await response.json()).code, code, handle);
    assert.equal(w.db.writes.length, 0, handle);
  }
});

test('rename: a watched-brand handle sends an approved record back to review; a suspended or missing record cannot rename', async () => {
  const w = world({ seed: withRecord() });
  assert.deepEqual(await (await rename(w, 'google-hr')).json(), { ok: true, handle: 'google-hr', status: 'pending' });
  const stored = w.db.docs('headhunters')[owner.uid];
  assert.deepEqual({ status: stored.status, reason: stored.reviewReason, flags: [...stored.flags] }, { status: 'pending', reason: 'flagged-handle', flags: ['lookalike:google'] });
  for (const [seed, status] of [[withRecord({ status: 'suspended' }), 409], [{ headhunters: {}, handles: {} }, 404]]) {
    assert.equal((await rename(world({ seed }), 'fresh-name')).status, status);
  }
});

// ---------------------------------------------------------------------------------------------
// Edit and read
// ---------------------------------------------------------------------------------------------

test('PATCH: validated fields only; a new display name sends an approved record back to review, other fields keep it approved', async () => {
  const edit = (w, body) => call(w.routes.headhunter(), 'PATCH', '/api/headhunter', body);
  const w = world({ seed: withRecord({ tagline: 'old' }) });
  assert.equal((await edit(w, { tagline: 'New tagline', contact: { phone: '050-123-4567' } })).status, 200);
  let stored = w.db.docs('headhunters')[owner.uid];
  assert.deepEqual({ status: stored.status, tagline: stored.tagline, version: stored.version, name: stored.displayName, contact: { ...stored.contact } }, { status: 'approved', tagline: 'New tagline', version: 2, name: 'Acme Recruiting', contact: { phone: '0501234567' } });
  assert.equal((await edit(w, { displayName: 'Acme Talent' })).status, 200);
  stored = w.db.docs('headhunters')[owner.uid];
  assert.deepEqual({ status: stored.status, reason: stored.reviewReason, name: stored.displayName, version: stored.version }, { status: 'pending', reason: 'display-name-changed', name: 'Acme Talent', version: 3 });
  assert.equal((await edit(w, { tagline: null })).status, 200);
  assert.equal(w.db.docs('headhunters')[owner.uid].tagline, undefined, 'null clears an optional field');
  assert.ok(w.state.revalidated.includes('headhunter:acme-hr'));
  assert.deepEqual([...new Set(withLimits(w.state))], ['headhunter.edit']);

  for (const [body, status] of [[{ handle: 'sneaky' }, 400], [{ status: 'approved' }, 400], [{ about: 'see https://spam.example' }, 400], [{ kind: 'bank' }, 400], [{ contact: {} }, 400]]) {
    const attempt = world({ seed: withRecord() });
    assert.equal((await edit(attempt, body)).status, status, JSON.stringify(body));
    assert.equal(attempt.db.writes.length, 0);
  }
  for (const state of ['suspended', 'rejected']) assert.equal((await edit(world({ seed: withRecord({ status: state }) }), { tagline: 'x' })).status, 409, state);
  assert.equal((await edit(world({ seed: { headhunters: {} } }), { tagline: 'x' })).status, 404);
});

test('PATCH resubmits an eligible draft (after "request changes") as pending', async () => {
  const w = world({ seed: withRecord({ status: 'draft', reviewReason: 'Fix the website link' }) });
  assert.equal((await call(w.routes.headhunter(), 'PATCH', '/api/headhunter', { contact: { website: 'https://acme.example' } })).status, 200);
  const stored = w.db.docs('headhunters')[owner.uid];
  assert.equal(stored.status, 'pending');
  assert.equal(stored.reviewReason, undefined);
});

test('GET own record: progress, and a public URL only while live', async () => {
  const read = async (seed, extra = {}) => { const w = world({ seed, ...extra }); return (await call(w.routes.headhunter(), 'GET', '/api/headhunter')).json(); };
  const none = await read({});
  assert.deepEqual({ headhunter: none.headhunter, applicationsOpen: none.applicationsOpen, required: none.required }, { headhunter: null, applicationsOpen: true, required: 10 });
  const draft = (await read({ headhunters: { [owner.uid]: record({ counters: { published: 7 } }) } })).headhunter;
  assert.deepEqual({ status: draft.status, published: draft.progress.published, required: draft.progress.required, eligible: draft.progress.eligible, live: draft.live, publicUrl: draft.publicUrl, label: draft.progress.label }, { status: 'draft', published: 7, required: 10, eligible: false, live: false, publicUrl: null, label: '7 מתוך 10 פרויקטים' });
  const live = (await read(withRecord())).headhunter;
  assert.equal(live.publicUrl, urls.minisiteUrl('acme-hr'));
  assert.equal(live.live, true);
  const restricted = (await read({ ...withRecord(), accountSecurity: { [owner.uid]: { state: 'restricted' } } })).headhunter;
  assert.equal(restricted.publicUrl, null);
  const rejected = (await read({ headhunters: { [owner.uid]: record({ status: 'rejected', rejectedReason: 'Cannot verify the agency', flags: ['lookalike:google'], approvedBy: 'mod' }) } })).headhunter;
  assert.equal(rejected.reason, 'Cannot verify the agency');
  assert.doesNotMatch(JSON.stringify(rejected), /lookalike|approvedBy|ownerUid/, 'internal review data stays internal');
  const signedOut = world(); signedOut.state.user = null;
  assert.equal((await call(signedOut.routes.headhunter(), 'GET', '/api/headhunter')).status, 401);
});

// ---------------------------------------------------------------------------------------------
// The counter
// ---------------------------------------------------------------------------------------------

const publishBody = (extra = {}) => ({ title: 'Landing page for a campaign', category: 'כללי', description: `${LONG.repeat(4)}`, budget: '₪5,000', deadline: 'גמיש', skills: ['React'], ...extra });
const importBlock = { provider: 'xplace', url: 'xplace.com/project?id=123456', attested: true, publisherNameOnSource: 'Acme Studio' };
const counters = (w) => w.db.docs('headhunters')[owner.uid];

test('counter: a countable project created through the plain branch increments, sets lastProjectAt and takes part in the same transaction', async () => {
  const w = world({ seed: { headhunters: { [owner.uid]: record() } } });
  const response = await call(w.routes.projects(), 'POST', '/api/marketplace/projects', publishBody());
  assert.equal(response.status, 201);
  assert.deepEqual({ ...counters(w).counters }, { published: 1, lastProjectAt: 'SERVER_TS' });
  assert.equal(counters(w).status, 'draft');
  assert.ok(w.db.docs('projects')['slug-1']);
  assert.deepEqual(w.state.revalidated, [], 'nothing visible changed, so no headhunter cache is dropped');
});

test('counter: the XPlace import branch counts too, in its own transaction', async () => {
  const w = world({ seed: { headhunters: { [owner.uid]: record() }, profiles: { [owner.uid]: { name: 'Acme Studio' } } } });
  const response = await call(w.routes.projects(), 'POST', '/api/marketplace/projects', publishBody({ import: importBlock }));
  assert.equal(response.status, 201);
  assert.equal(counters(w).counters.published, 1);
  assert.ok(w.db.docs('projects')['slug-1'].importSource);
  // A rejected import (already imported) counts nothing.
  const again = await call(w.routes.projects(), 'POST', '/api/marketplace/projects', publishBody({ import: importBlock }));
  assert.equal(again.status, 409);
  assert.equal(counters(w).counters.published, 1);
});

test('counter: a short description, an owner without a headhunter record, and a failed publish change nothing', async () => {
  const short = world({ seed: { headhunters: { [owner.uid]: record() } } });
  assert.equal((await call(short.routes.projects(), 'POST', '/api/marketplace/projects', publishBody({ description: 'Between twenty and eighty characters only.' }))).status, 201);
  assert.deepEqual({ ...counters(short).counters }, { published: 0 });
  assert.equal(short.db.writes.filter((write) => write.collection === 'headhunters').length, 0);

  const plain = world();
  assert.equal((await call(plain.routes.projects(), 'POST', '/api/marketplace/projects', publishBody())).status, 201);
  assert.equal(plain.db.writes.filter((write) => write.collection === 'headhunters').length, 0);

  const invalid = world({ seed: { headhunters: { [owner.uid]: record() } } });
  assert.equal((await call(invalid.routes.projects(), 'POST', '/api/marketplace/projects', publishBody({ title: 'x' }))).status, 400);
  assert.equal(counters(invalid).counters.published, 0);
});

test('counter: AI/sample projects never count, but ordinary countable ones do (the rule is countsTowardHeadhunter)', async () => {
  const w = world({ seed: { headhunters: { [owner.uid]: record({ counters: { published: 2 } }) } } });
  const data = w.routes.data();
  const create = (id, extra) => w.db.runTransaction(async (tx) => {
    const snapshot = await data.readHeadhunterForCounter(tx, owner.uid);
    return data.applyProjectCreated(tx, snapshot, { ...project(1), ...extra });
  });
  for (const extra of [{ sample: true }, { unreal: true }, { owner: { kind: 'ai-agent' } }, { description: 'too short' }, { status: 'archived' }]) assert.equal(await create('x', extra), null, JSON.stringify(extra));
  assert.equal(counters(w).counters.published, 2);
  const outcome = await create('y', {});
  assert.deepEqual({ ...outcome }, { handle: 'acme-hr', statusChanged: false, becameEligible: false, status: 'draft' });
  assert.equal(counters(w).counters.published, 3);
});

test('counter: reaching the threshold sets eligibleAt once and moves a draft to pending; the headhunter cache is dropped', async () => {
  const w = world({ seed: { headhunters: { [owner.uid]: record({ counters: { published: 9 } }) } } });
  assert.equal((await call(w.routes.projects(), 'POST', '/api/marketplace/projects', publishBody())).status, 201);
  const stored = counters(w);
  assert.deepEqual({ published: stored.counters.published, status: stored.status, eligibleAt: stored.eligibleAt, version: stored.version }, { published: 10, status: 'pending', eligibleAt: 'SERVER_TS', version: 2 });
  assert.deepEqual(w.state.revalidated, ['headhunters', 'headhunter:acme-hr']);
  // Later projects keep the unlock and the status (sticky).
  w.state.revalidated.length = 0;
  w.db.docs('headhunters')[owner.uid].eligibleAt = 123;
  assert.equal((await call(w.routes.projects(), 'POST', '/api/marketplace/projects', publishBody({ title: 'Another unrelated title' }))).status, 201);
  assert.deepEqual({ published: counters(w).counters.published, eligibleAt: counters(w).eligibleAt, status: counters(w).status }, { published: 11, eligibleAt: 123, status: 'pending' });
  assert.deepEqual(w.state.revalidated, []);
});

test('counter: removing a project decrements; an approved record below the review floor goes back to pending with a reason', async () => {
  const w = world({ seed: withRecord({ counters: { published: 6 } }) });
  const data = w.routes.data();
  const remove = (before) => w.db.runTransaction(async (tx) => data.applyProjectRemoved(tx, await data.readHeadhunterForCounter(tx, owner.uid), before));
  const first = await remove(project(1));
  assert.deepEqual({ ...first }, { handle: 'acme-hr', statusChanged: false, becameEligible: false, status: 'approved' });
  assert.equal(counters(w).counters.published, 5);
  assert.equal(counters(w).eligibleAt, 1, 'the unlock is sticky');
  const second = await remove(project(2));
  assert.equal(second.statusChanged, true);
  assert.deepEqual({ published: counters(w).counters.published, status: counters(w).status, reason: counters(w).reviewReason }, { published: 4, status: 'pending', reason: 'below-review-floor' });
  assert.equal(await remove(project(3, { sample: true })), null, 'a project that never counted is not subtracted');
  assert.equal(counters(w).counters.published, 4);
  w.db.docs('headhunters')[owner.uid].counters.published = 0;
  await remove(project(4));
  assert.equal(counters(w).counters.published, 0, 'never below zero');
});

test('counter rules (pure): unlock is sticky, drafts become review requests, approved records re-review below the floor', () => {
  const { planCounter } = loadModule('src/lib/headhunters/counter.ts');
  const plan = (status, published, hasEligibleAt, next) => ({ ...planCounter({ status, published, hasEligibleAt }, next) });
  assert.deepEqual(plan('draft', 9, false, 10), { published: 10, setEligibleAt: true, status: 'pending', statusChanged: true, becameEligible: true });
  assert.deepEqual(plan('draft', 3, false, 4), { published: 4, setEligibleAt: false, statusChanged: false, becameEligible: false });
  assert.deepEqual(plan('pending', 9, false, 10), { published: 10, setEligibleAt: true, statusChanged: false, becameEligible: true });
  assert.deepEqual(plan('approved', 12, true, 9), { published: 9, setEligibleAt: false, statusChanged: false, becameEligible: false });
  assert.equal(plan('approved', 5, true, 4).status, 'pending');
  assert.equal(plan('suspended', 5, true, 1).status, undefined, 'only an approved record is re-reviewed');
  assert.equal(plan('draft', 12, true, 12).status, 'pending', 'an eligible draft is a review request');
  assert.equal(plan('draft', 0, false, -3).published, 0);
});

// ---------------------------------------------------------------------------------------------
// Reconcile
// ---------------------------------------------------------------------------------------------

test('reconcile recounts from projects (duplicates once, uncountable skipped), reports drift, and writes only when asked', async () => {
  const dupes = { 'dup-1': project(0, { ownerUid: owner.uid }), 'dup-2': project(0, { ownerUid: owner.uid }), 'p-short': project(50, { description: 'short' }) };
  const w = world({ seed: { headhunters: { [owner.uid]: record({ counters: { published: 4 } }) }, projects: { ...projects(6), ...dupes } } });
  const data = w.routes.data();
  const dry = await data.reconcileHeadhunter(owner.uid);
  assert.deepEqual({ ...dry }, { uid: owner.uid, handle: 'acme-hr', stored: 4, actual: 6, drift: 2, duplicates: 2, truncated: false, written: false });
  assert.equal(w.db.writes.length, 0);
  const written = await data.reconcileHeadhunter(owner.uid, { write: true });
  assert.equal(written.written, true);
  assert.equal(counters(w).counters.published, 6);
  assert.equal((await data.reconcileHeadhunter(owner.uid, { write: true })).written, false, 'no drift, nothing to write');
  assert.equal(await data.reconcileHeadhunter('nobody'), null);
});

test('reconcile with write applies the same unlock and review rules as the live counter', async () => {
  const w = world({ seed: { headhunters: { [owner.uid]: record({ counters: { published: 3 } }) }, projects: projects(10) } });
  const result = await w.routes.data().reconcileHeadhunter(owner.uid, { write: true });
  assert.deepEqual({ published: counters(w).counters.published, status: counters(w).status, eligibleAt: counters(w).eligibleAt }, { published: 10, status: 'pending', eligibleAt: 'SERVER_TS' });
  assert.deepEqual({ ...result.outcome }, { handle: 'acme-hr', statusChanged: true, becameEligible: true, status: 'pending' });
});

// ---------------------------------------------------------------------------------------------
// Moderation
// ---------------------------------------------------------------------------------------------

const decide = (w, body) => call(w.routes.moderation(), 'POST', '/api/moderation/headhunters', body);
const moderator = 'moderator-1';
const pending = (extra = {}) => ({ headhunters: { [owner.uid]: record({ status: 'pending', eligibleAt: 1, counters: { published: 10 }, ...extra }) }, handles: { 'acme-hr': handleDoc('acme-hr', owner.uid) }, projects: projects(10) });

test('moderation: only a recent-MFA moderator, from the same origin; nothing is read or written otherwise', async () => {
  const w = world({ seed: pending() });
  const route = w.routes.moderation();
  assert.equal((await call(route, 'GET', '/api/moderation/headhunters')).status, 403);
  assert.equal((await call(route, 'POST', '/api/moderation/headhunters', { uid: owner.uid, action: 'approve' })).status, 403);
  w.state.moderator = moderator; w.state.sameOrigin = false;
  assert.equal((await call(route, 'POST', '/api/moderation/headhunters', { uid: owner.uid, action: 'approve' })).status, 403);
  assert.equal(w.db.writes.length, 0);
  assert.equal(w.db.docs('headhunters')[owner.uid].status, 'pending');
});

test('moderation approve: needs an eligible record, then sets approvedAt/By, writes the audit entry in the same transaction and expires the caches', async () => {
  const notEligible = world({ seed: { headhunters: { [owner.uid]: record({ status: 'pending', counters: { published: 3 } }) }, projects: projects(3) }, moderator });
  const refused = await decide(notEligible, { uid: owner.uid, action: 'approve' });
  assert.equal(refused.status, 409);
  assert.equal((await refused.json()).error, 'NOT_ELIGIBLE');
  assert.equal(notEligible.db.docs('headhunters')[owner.uid].status, 'pending');
  assert.equal(audits(notEligible.db).length, 0);

  const w = world({ seed: pending({ counters: { published: 8 } }), moderator });
  const response = await decide(w, { uid: owner.uid, action: 'approve' });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, status: 'approved' });
  const stored = w.db.docs('headhunters')[owner.uid];
  assert.deepEqual({ status: stored.status, approvedBy: stored.approvedBy, approvedAt: stored.approvedAt, version: stored.version, published: stored.counters.published }, { status: 'approved', approvedBy: moderator, approvedAt: 'SERVER_TS', version: 2, published: 10 });
  assert.deepEqual(audits(w.db).map((event) => ({ ...event })), [{ actorUid: moderator, targetUid: owner.uid, action: 'headhunter.approve', fromStatus: 'pending', toStatus: 'approved', via: 'api', createdAt: 'SERVER_TS' }]);
  assert.deepEqual(w.state.revalidated, ['headhunters', 'headhunter:acme-hr']);
  assert.equal((await decide(w, { uid: owner.uid, action: 'approve' })).status, 409, 'already approved');
});

test('moderation reject and suspend need a reason; revoking never retires the handle; reinstate restores', async () => {
  const w = world({ seed: { ...pending(), headhunters: { [owner.uid]: record({ status: 'approved', eligibleAt: 1, approvedAt: 1, counters: { published: 10 } }) } }, moderator });
  for (const action of ['reject', 'suspend', 'request-changes']) {
    const response = await decide(w, { uid: owner.uid, action });
    assert.equal(response.status, 400, action);
    assert.equal((await response.json()).error, 'REASON_REQUIRED');
    assert.equal((await decide(w, { uid: owner.uid, action, reason: 'x' })).status, 400, 'too short');
  }
  assert.equal(audits(w.db).length, 0);
  assert.equal((await decide(w, { uid: owner.uid, action: 'suspend', reason: 'Impersonation report' })).status, 200);
  let stored = w.db.docs('headhunters')[owner.uid];
  assert.deepEqual({ status: stored.status, reason: stored.suspendedReason }, { status: 'suspended', reason: 'Impersonation report' });
  assert.deepEqual({ ...w.db.docs('handles')['acme-hr'] }, handleDoc('acme-hr', owner.uid), 'the handle is untouched');
  assert.equal((await decide(w, { uid: owner.uid, action: 'reinstate' })).status, 200);
  stored = w.db.docs('headhunters')[owner.uid];
  assert.deepEqual({ status: stored.status, reason: stored.suspendedReason }, { status: 'approved', reason: undefined });
  assert.equal((await decide(w, { uid: owner.uid, action: 'reject', reason: 'Not an agency' })).status, 200);
  assert.deepEqual({ status: w.db.docs('headhunters')[owner.uid].status, reason: w.db.docs('headhunters')[owner.uid].rejectedReason }, { status: 'rejected', reason: 'Not an agency' });
  assert.equal(w.db.docs('handles')['acme-hr'].state, 'active', 'a rejected headhunter keeps the handle');
  assert.deepEqual(audits(w.db).map((event) => [event.action, event.reason ?? null]), [['headhunter.suspend', 'Impersonation report'], ['headhunter.reinstate', null], ['headhunter.reject', 'Not an agency']]);
});

test('moderation request-changes sends a pending record back to draft with the reason; the owner then resubmits', async () => {
  const w = world({ seed: pending(), moderator });
  assert.equal((await decide(w, { uid: owner.uid, action: 'request-changes', reason: 'Please add a company website' })).status, 200);
  const stored = w.db.docs('headhunters')[owner.uid];
  assert.deepEqual({ status: stored.status, reason: stored.reviewReason }, { status: 'draft', reason: 'Please add a company website' });
  w.state.moderator = null;
  assert.equal((await call(w.routes.headhunter(), 'PATCH', '/api/headhunter', { contact: { website: 'https://acme.example' } })).status, 200);
  assert.equal(w.db.docs('headhunters')[owner.uid].status, 'pending');
});

test('moderation input: unknown action, bad uid, own record, missing record and wrong state are refused', async () => {
  const w = world({ seed: pending(), moderator });
  for (const [body, status] of [
    [{ uid: owner.uid, action: 'delete' }, 400], [{ uid: '../x', action: 'approve' }, 400], [{ action: 'approve' }, 400], [{ uid: owner.uid, action: 'approve', reason: 7 }, 400],
    [{ uid: moderator, action: 'approve' }, 400], [{ uid: 'ghost', action: 'approve' }, 404], [{ uid: owner.uid, action: 'reinstate' }, 409],
  ]) assert.equal((await decide(w, body)).status, status, JSON.stringify(body));
  assert.equal(audits(w.db).length, 0);
});

test('moderation GET lists pending first with flags and counters, by status when asked, and writes an audit entry', async () => {
  const seed = { headhunters: {
    a: record({ ownerUid: 'a', status: 'approved', handle: 'a-agency', displayName: 'A', createdAt: 1 }),
    b: record({ ownerUid: 'b', status: 'pending', handle: 'b-agency', displayName: 'B', flags: ['lookalike:google'], counters: { published: 11 }, createdAt: 3, eligibleAt: 2 }),
    c: record({ ownerUid: 'c', status: 'pending', handle: 'c-agency', displayName: 'C', createdAt: 2 }),
    d: record({ ownerUid: 'd', status: 'draft', handle: 'd-agency', displayName: 'D', createdAt: 1 }),
  } };
  const w = world({ seed, moderator });
  const all = (await (await call(w.routes.moderation(), 'GET', '/api/moderation/headhunters')).json()).items;
  assert.deepEqual(all.map((item) => item.uid), ['c', 'b', 'd', 'a']);
  assert.deepEqual({ flags: all[1].flags, published: all[1].published, eligibleAt: all[1].eligibleAt }, { flags: ['lookalike:google'], published: 11, eligibleAt: 2 });
  assert.deepEqual((await (await call(w.routes.moderation(), 'GET', '/api/moderation/headhunters?status=approved')).json()).items.map((item) => item.uid), ['a']);
  assert.equal((await call(w.routes.moderation(), 'GET', '/api/moderation/headhunters?status=bogus')).status, 400);
  assert.deepEqual(audits(w.db).map((event) => event.action), ['headhunter.queue.read', 'headhunter.queue.read']);
});

test('moderation runs while the public feature switch is off (review before launch)', async () => {
  const w = world({ seed: { ...pending(), config: {} }, moderator });
  assert.equal((await decide(w, { uid: owner.uid, action: 'approve' })).status, 200);
});

test('the shared moderation rules (pure): required reasons and the transition table', () => {
  const { parseDecision, nextStatus } = loadModule('src/lib/headhunters/moderation.ts');
  assert.deepEqual({ ...parseDecision({ uid: 'u1', action: 'approve' }) }.ok, true);
  assert.equal(parseDecision({ uid: 'u1', action: 'reject' }).code, 'REASON_REQUIRED');
  assert.equal(parseDecision({ uid: 'u1', action: 'reject', reason: '  Not   an agency ' }).value.reason, 'Not an agency');
  assert.equal(parseDecision({ uid: 'u1', action: 'reject', reason: 'x'.repeat(501) }).code, 'INVALID_DECISION');
  assert.equal(nextStatus('approve', 'pending', false), 'approved');
  assert.equal(nextStatus('approve', 'draft', false), null);
  assert.equal(nextStatus('reinstate', 'suspended', true), 'approved');
  assert.equal(nextStatus('reinstate', 'suspended', false), 'pending');
  assert.equal(nextStatus('reinstate', 'rejected', true), 'pending');
  assert.equal(nextStatus('suspend', 'rejected', true), null);
});

// ---------------------------------------------------------------------------------------------
// Public reads
// ---------------------------------------------------------------------------------------------

test('getPublicHeadhunters: only live headhunters (approved, eligible, account active) with just { name, handle }, in one batched read per kind', async () => {
  const live = (uid, extra = {}) => record({ ownerUid: uid, status: 'approved', eligibleAt: 1, displayName: `Name ${uid}`, handle: `agency-${uid.toLowerCase()}`, ...extra });
  const w = world({ seed: {
    headhunters: {
      ok: live('ok'), pending: live('pending', { status: 'pending' }), draft: live('draft', { status: 'draft' }), suspended: live('suspended', { status: 'suspended' }), rejected: live('rejected', { status: 'rejected' }),
      noEligible: live('noEligible', { eligibleAt: undefined }), restricted: live('restricted'), banned: live('banned'), explicitActive: live('explicitActive'),
    },
    accountSecurity: { restricted: { state: 'restricted' }, banned: { state: 'suspended' }, explicitActive: { state: 'active' } },
  } });
  let batches = 0;
  const getAll = w.db.getAll;
  w.db.getAll = async (...refs) => { batches += 1; return getAll(...refs); };
  const found = await w.routes.data().getPublicHeadhunters(['ok', 'pending', 'draft', 'suspended', 'rejected', 'noEligible', 'restricted', 'banned', 'explicitActive', 'missing', 'ok', 'explicitActive']);
  assert.deepEqual([...found.keys()].sort(), ['explicitActive', 'ok']);
  assert.deepEqual({ ...found.get('ok') }, { name: 'Name ok', handle: 'agency-ok' });
  assert.equal(batches, 2, 'one getAll for the distinct headhunter records, one for their account states');
  batches = 0;
  assert.equal((await w.routes.data().getPublicHeadhunters([])).size, 0);
  assert.equal((await w.routes.data().getPublicHeadhunters(['pending'])).size, 0);
  assert.equal(batches, 1, 'no account read when nobody is a candidate');
});

test('getPublicHeadhunters is cached per sorted uid set under the headhunters tag; invalidateHeadhunterCache expires both tags', async () => {
  const keys = [];
  const w = world();
  const data = loadModule('src/lib/db/headhunters.ts', { env: { NEXT_PUBLIC_SITE_URL: SITE }, stubs: {
    'next/cache': { unstable_cache: (fn, keyParts, options) => { keys.push([keyParts, options]); return fn; }, revalidateTag: (tag, options) => w.state.revalidated.push([tag, { ...options }]) },
    'node:crypto': { createHash }, '@/lib/db/firestore': { firestore: () => w.db },
    'firebase-admin/firestore': { FieldValue: {} }, '@/lib/security/marketplace-policy': { accountState: () => 'active' },
  } });
  await data.getPublicHeadhunters(['b', 'a']);
  await data.getPublicHeadhunters(['a', 'b', 'a']);
  const publicKeys = keys.filter(([parts]) => parts[0] === 'headhunters-public');
  assert.equal(publicKeys[0][0][1], publicKeys[1][0][1], 'the order and duplicates do not change the key');
  assert.deepEqual([...publicKeys[0][1].tags], ['headhunters']);
  assert.equal(publicKeys[0][1].revalidate, 60);
  data.invalidateHeadhunterCache('acme-hr');
  data.invalidateHeadhunterCache('../bad');
  assert.deepEqual(w.state.revalidated, [['headhunters', { expire: 0 }], ['headhunter:acme-hr', { expire: 0 }], ['headhunters', { expire: 0 }]]);
});

test('getHeadhunterByHandle: the format is checked before any read; active, redirect and unknown handles', async () => {
  const seed = {
    headhunters: { [owner.uid]: record({ status: 'approved', eligibleAt: 5, createdAt: { toMillis: () => 99 } }) },
    handles: { 'acme-hr': handleDoc('acme-hr', owner.uid), 'old-hr': handleDoc('old-hr', owner.uid, { state: 'retired', pointsTo: 'acme-hr' }), 'dead-hr': handleDoc('dead-hr', owner.uid, { state: 'retired' }), 'moved-hr': handleDoc('moved-hr', owner.uid) },
  };
  const w = world({ seed });
  let reads = 0;
  const collection = w.db.collection;
  w.db.collection = (name) => { reads += 1; return collection(name); };
  const data = w.routes.data();
  for (const probe of ['.env', 'Acme', 'a', 'a--b', '../x', 'robots.txt', 'x'.repeat(40)]) assert.equal(await data.getHeadhunterByHandle(probe), null, probe);
  assert.equal(reads, 0, 'malformed handles never reach Firestore');
  const active = await data.getHeadhunterByHandle('acme-hr');
  assert.equal(active.kind, 'active');
  assert.deepEqual({ name: active.record.displayName, uid: active.record.ownerUid, createdAt: active.record.createdAt }, { name: 'Acme Recruiting', uid: owner.uid, createdAt: 99 }, 'timestamps are plain numbers');
  assert.deepEqual({ ...await data.getHeadhunterByHandle('old-hr') }, { kind: 'redirect', to: 'acme-hr' });
  assert.equal(await data.getHeadhunterByHandle('dead-hr'), null, 'a revoked, retired handle without a target is a 404');
  assert.equal(await data.getHeadhunterByHandle('moved-hr'), null, 'the ledger and the record must agree');
  assert.equal(await data.getHeadhunterByHandle('never-seen'), null);
});

// ---------------------------------------------------------------------------------------------
// Rules and layout guards
// ---------------------------------------------------------------------------------------------

test('the new rate-limit actions exist with a per-window budget', () => {
  const source = loadModule('src/lib/security/rate-limit.ts', { stubs: { 'node:crypto': { createHash }, 'firebase-admin/firestore': { Timestamp: {} }, '@/lib/db/firestore': { firestore() {} } } });
  for (const action of ['headhunter.edit', 'headhunter.handle']) {
    assert.ok(source.actionLimits[action].length >= 2, action);
    for (const policy of source.actionLimits[action]) assert.ok(policy.max > 0 && policy.windowMs > 0);
  }
});

test('the headhunter data code builds no URL itself: no host, scheme or localhost in the new files', async () => {
  const { readFileSync } = await import('node:fs');
  const { projectRoot } = await import('./helpers/load-ts.mjs');
  for (const file of ['src/lib/db/headhunters.ts', 'src/lib/headhunters/store.ts', 'src/lib/headhunters/view.ts', 'src/app/api/headhunter/route.ts', 'src/app/api/headhunter/handle/route.ts', 'src/app/api/moderation/headhunters/route.ts', 'scripts/headhunters/review.ts', 'scripts/headhunters/reconcile.ts']) {
    assert.doesNotMatch(readFileSync(`${projectRoot}/${file}`, 'utf8'), /https?:\/\/|localhost|freelance-place\.com/i, file);
  }
});
