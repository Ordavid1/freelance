import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadModule } from './helpers/load-ts.mjs';
import { createFakeFirestore } from './helpers/fake-firestore.mjs';

// WP3 and WP4: the headhunter tag on project cards and the minisite page, over the in-memory Firestore and stubbed Next.js.

const SITE = 'https://freelance-place.com';
const env = { SITE_INDEXABLE: 'true', NEXT_PUBLIC_SITE_URL: SITE };
const stamp = (ms) => ({ toMillis: () => ms });
const plain = (value) => JSON.parse(JSON.stringify(value));
const NOT_FOUND = { digest: 'NEXT_NOT_FOUND' };
// The default next/link stub has no __esModule flag; components import it as a default.
const ui = {
  'next/link': { __esModule: true, default: ({ href, children, prefetch, ...rest }) => createElement('a', { href, ...rest }, children) },
  'next/image': { __esModule: true, default: ({ src, alt }) => createElement('img', { src, alt }) },
};

const liveRecord = (uid, extra = {}) => ({
  ownerUid: uid, status: 'approved', eligibleAt: 1, displayName: `Agency ${uid}`, handle: `agency-${uid}`, kind: 'agency', city: 'Tel Aviv',
  tagline: 'We place developers', about: 'First paragraph.\n\nSecond paragraph.', contact: { email: 'jobs@acme.example', website: 'https://acme.example', whatsapp: '972501234567', linkedin: 'https://www.linkedin.com/company/acme', phone: '+972-3-555-0100' },
  counters: { published: 12 }, flags: ['lookalike:secret'], reviewReason: 'internal note', version: 3, ...extra,
});
const project = (extra = {}) => ({ status: 'open', title: 'כותרת הפרויקט', description: 'תיאור הפרויקט המלא', createdAt: stamp(1000), ...extra });

// ---------------------------------------------------------------------------------------------
// Readers (src/lib/db/projects.ts)
// ---------------------------------------------------------------------------------------------

// Hand-made Firestore for the readers: chainable queries (status filters, document-ID order, limit) and doc reads.
function readerDb(documents) {
  const snapshot = (id, data) => ({ id, exists: true, data: () => data, get: (key) => data[key] });
  const query = (state = {}) => ({
    orderBy: () => query({ ...state, ordered: true }),
    startAfter: (cursor) => query({ ...state, after: cursor }),
    limit: (n) => query({ ...state, limit: n }),
    get: async () => {
      let docs = [...documents];
      if (state.ordered) docs.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
      if (state.after !== undefined) docs = docs.filter(([id]) => id > state.after);
      if (state.limit !== undefined) docs = docs.slice(0, state.limit);
      return { size: docs.length, docs: docs.map(([id, data]) => snapshot(id, data)) };
    },
  });
  return () => ({ collection: () => ({
    where: () => query(),
    doc: (id) => ({ get: async () => { const found = documents.find(([key]) => key === id); return found ? snapshot(...found) : { exists: false, get: () => undefined, data: () => undefined }; } }),
  }) });
}

function loadReaders(documents, headhunters) {
  const cached = [];
  const module = loadModule('src/lib/db/projects.ts', { env, stubs: {
    './firestore': { firestore: readerDb(documents) },
    'firebase-admin/firestore': { FieldPath: { documentId: () => '__name__' } },
    'next/cache': { unstable_cache: (fn, keys, options) => { cached.push({ keys, options }); return fn; } },
    '@/lib/db/headhunters': headhunters,
  } });
  return { module, cached };
}
function spies({ enabled = true, tags = {}, fail = false } = {}) {
  const calls = { config: 0, lookups: [] };
  return {
    calls,
    stub: {
      getHeadhunterConfig: async () => { calls.config += 1; return { enabled, applicationsOpen: false }; },
      getPublicHeadhunters: async (uids) => { calls.lookups.push([...uids]); if (fail) throw new Error('firestore down'); return new Map(Object.entries(tags).filter(([uid]) => uids.includes(uid))); },
    },
  };
}
const TAGS = { hh1: { name: 'Agency One', handle: 'agency-one' } };
const feedDocs = () => [
  ['p-open', project({ ownerUid: 'hh1', createdAt: stamp(5000) })],
  ['p-closed', project({ ownerUid: 'hh1', status: 'closed', createdAt: stamp(4000) })],
  ['p-plain', project({ ownerUid: 'u2', createdAt: stamp(3000) })],
  ['p-sample', project({ ownerUid: 'synthetic-owner', sample: true, owner: { kind: 'ai-agent', name: 'סוכן' }, createdAt: stamp(2000) })],
  ['p-unreal', project({ ownerUid: 'hh1', unreal: true, createdAt: stamp(1500) })],
  ['p-no-owner', project({ createdAt: stamp(1000) })],
];

test('listFeedProjects tags only live headhunters, never showcase projects, with one lookup for the page and no owner uid in the output', async () => {
  const { calls, stub } = spies({ tags: { ...TAGS, 'synthetic-owner': { name: 'Should not appear', handle: 'nope-nope' } } });
  const { module } = loadReaders(feedDocs(), stub);
  const items = plain(await module.listFeedProjects());
  const bySlug = Object.fromEntries(items.map((item) => [item.slug, item]));
  assert.deepEqual(bySlug['p-open'].headhunter, { name: 'Agency One', handle: 'agency-one' });
  assert.deepEqual(bySlug['p-closed'].headhunter, { name: 'Agency One', handle: 'agency-one' }, 'a closed project keeps its tag');
  for (const slug of ['p-plain', 'p-sample', 'p-unreal', 'p-no-owner']) assert.equal(bySlug[slug].headhunter, undefined, `${slug} has no tag`);
  assert.equal(calls.lookups.length, 1, 'getPublicHeadhunters is called once per page, not per project');
  assert.deepEqual(calls.lookups[0].filter((uid, index, all) => all.indexOf(uid) === index).sort(), ['hh1', 'u2'], 'showcase owners are never looked up');
  const json = JSON.stringify(items);
  assert.doesNotMatch(json, /ownerUid|synthetic-owner|"u2"|"hh1"/, 'the owner uid never leaves the reader');
});

test('no tags at all while the feature switch is off, and no headhunter read either', async () => {
  const { calls, stub } = spies({ enabled: false, tags: TAGS });
  const { module } = loadReaders(feedDocs(), stub);
  const items = await module.listFeedProjects();
  assert.equal(items.length, 6);
  assert.ok(items.every((item) => item.headhunter === undefined));
  assert.equal(calls.lookups.length, 0);
});

test('a failed headhunter read costs the tags, never the projects', async () => {
  const { stub } = spies({ tags: TAGS, fail: true });
  const { module } = loadReaders(feedDocs(), stub);
  const warn = console.warn; console.warn = () => {};
  try {
    const items = await module.listFeedProjects();
    assert.equal(items.length, 6);
    assert.ok(items.every((item) => item.headhunter === undefined));
  } finally { console.warn = warn; }
});

test('listOpenProjects and getOpenProject attach the tag too, with the same single lookup rule', async () => {
  const { calls, stub } = spies({ tags: TAGS });
  const { module } = loadReaders(feedDocs(), stub);
  const open = plain(await module.listOpenProjects());
  assert.deepEqual(open.map((item) => item.slug), ['p-open', 'p-plain', 'p-no-owner'].filter((slug) => open.some((item) => item.slug === slug)), 'real open projects only, newest first');
  assert.deepEqual(open.find((item) => item.slug === 'p-open').headhunter, TAGS.hh1);
  assert.equal(calls.lookups.length, 1);
  const detail = plain(await module.getOpenProject('p-open'));
  assert.deepEqual(detail.headhunter, TAGS.hh1);
  assert.equal(JSON.stringify(detail).includes('ownerUid'), false);
  assert.equal((await module.getOpenProject('p-sample')).headhunter, undefined, 'a showcase project page has no tag');
});

test('the public readers keep their 60 s cache and also depend on the headhunters tag (suspension drops the tag within a cache cycle)', async () => {
  const { stub } = spies({ tags: TAGS });
  const { module, cached } = loadReaders(feedDocs(), stub);
  await module.listOpenProjects(); await module.listFeedProjects(); await module.getOpenProject('p-open');
  assert.equal(cached.length, 3);
  for (const { options } of cached) { assert.equal(options.revalidate, 60); assert.ok(options.tags.includes('projects')); assert.ok(options.tags.includes('headhunters')); }
});

// The real headhunters module over the in-memory Firestore: a suspended or restricted headhunter loses the tag.
function realTagWorld(seed) {
  const db = createFakeFirestore({ config: { headhunters: { enabled: true } }, ...seed });
  const headhunters = loadModule('src/lib/db/headhunters.ts', { env, stubs: {
    'next/cache': { unstable_cache: (fn) => fn, revalidateTag: () => {} }, 'node:crypto': { createHash },
    '@/lib/db/firestore': { firestore: () => db }, 'firebase-admin/firestore': { FieldValue: {} },
    '@/lib/security/marketplace-policy': { accountState: (value) => (value === undefined || value === 'active' ? 'active' : 'restricted') },
  } });
  const projects = loadModule('src/lib/db/projects.ts', { env, stubs: {
    './firestore': { firestore: () => db }, 'firebase-admin/firestore': { FieldPath: {} },
    'next/cache': { unstable_cache: (fn) => fn }, '@/lib/db/headhunters': headhunters,
  } });
  return { db, projects };
}

test('end to end over Firestore: live headhunter is tagged; suspended, unapproved, restricted or switched-off is not', async () => {
  const w = realTagWorld({
    headhunters: { hh1: liveRecord('hh1', { handle: 'agency-one', displayName: 'Agency One' }) },
    projects: { a: project({ ownerUid: 'hh1' }) },
  });
  assert.deepEqual(plain((await w.projects.getOpenProject('a')).headhunter), { name: 'Agency One', handle: 'agency-one' });
  await w.db.collection('headhunters').doc('hh1').set({ status: 'suspended' }, { merge: true });
  assert.equal((await w.projects.getOpenProject('a')).headhunter, undefined, 'suspended');
  await w.db.collection('headhunters').doc('hh1').set({ status: 'approved' }, { merge: true });
  await w.db.collection('accountSecurity').doc('hh1').set({ state: 'restricted' });
  assert.equal((await w.projects.getOpenProject('a')).headhunter, undefined, 'restricted account');
  await w.db.collection('accountSecurity').doc('hh1').set({ state: 'active' });
  assert.ok((await w.projects.getOpenProject('a')).headhunter, 'active again');
  await w.db.collection('config').doc('headhunters').set({ enabled: false });
  assert.equal((await w.projects.getOpenProject('a')).headhunter, undefined, 'feature switch off');
});

// ---------------------------------------------------------------------------------------------
// Minisite data (getHeadhunterProjects)
// ---------------------------------------------------------------------------------------------

function minisiteWorld() {
  const docs = {};
  for (let index = 0; index < 30; index++) docs[`open-${String(index).padStart(2, '0')}`] = project({ ownerUid: 'hh1', title: `פתוח ${index}`, createdAt: stamp(1000 + index) });
  for (let index = 0; index < 8; index++) docs[`closed-${index}`] = project({ ownerUid: 'hh1', status: 'closed', title: `סגור ${index}`, createdAt: stamp(10 + index), updatedAt: stamp(100 - index) });
  Object.assign(docs, {
    private: project({ ownerUid: 'hh1', visibility: 'private', createdAt: stamp(99999) }),
    archived: project({ ownerUid: 'hh1', status: 'archived', createdAt: stamp(99998) }),
    draft: project({ ownerUid: 'hh1', status: 'draft', createdAt: stamp(99997) }),
    sample: project({ ownerUid: 'hh1', sample: true, owner: { kind: 'ai-agent' }, createdAt: stamp(99996) }),
    unreal: project({ ownerUid: 'hh1', unreal: true, createdAt: stamp(99995) }),
    untitled: project({ ownerUid: 'hh1', title: '  ', createdAt: stamp(99994) }),
    other: project({ ownerUid: 'hh2', title: 'של מישהו אחר', createdAt: stamp(99993) }),
  });
  const db = createFakeFirestore({ projects: docs });
  const cached = [];
  const queries = [];
  const wrapped = { collection: (name) => { const c = db.collection(name); return { ...c, where: (...args) => { queries.push(args); return c.where(...args); } }; } };
  const module = loadModule('src/lib/db/projects.ts', { env, stubs: {
    './firestore': { firestore: () => wrapped }, 'firebase-admin/firestore': { FieldPath: {} },
    'next/cache': { unstable_cache: (fn, keys, options) => { cached.push({ keys, options }); return fn; } }, '@/lib/db/headhunters': {},
  } });
  return { module, cached, queries };
}

test('getHeadhunterProjects: this owner, public predicates, newest first, 24 per page, closed list capped at 6 by closing time', async () => {
  const { module, queries } = minisiteWorld();
  const first = plain(await module.getHeadhunterProjects('hh1', 'agency-one', 1));
  assert.deepEqual(queries[0].slice(0, 3), ['ownerUid', '==', 'hh1'], 'a single-field owner query');
  assert.equal(first.openCount, 30, 'private, archived, draft, showcase, untitled and other owners are excluded');
  assert.equal(first.publishedCount, 38, 'open + closed');
  assert.equal(first.items.length, 24);
  assert.equal(first.items[0].slug, 'open-29');
  assert.ok(first.items.every((item, index, all) => index === 0 || all[index - 1].createdAt >= item.createdAt), 'newest first');
  assert.ok(first.items.every((item) => item.status === 'open'));
  assert.deepEqual(first.closed.map((item) => item.slug), ['closed-0', 'closed-1', 'closed-2', 'closed-3', 'closed-4', 'closed-5'], 'the most recently closed first, six at most');
  const second = plain(await module.getHeadhunterProjects('hh1', 'agency-one', 2));
  assert.equal(second.items.length, 6);
  assert.equal(second.items.at(-1).slug, 'open-00');
  assert.equal(new Set([...first.items, ...second.items].map((item) => item.slug)).size, 30, 'the pages do not overlap');
  const beyond = plain(await module.getHeadhunterProjects('hh1', 'agency-one', 3));
  assert.deepEqual([beyond.items.length, beyond.openCount], [0, 30]);
  assert.equal(JSON.stringify([first, second]).includes('ownerUid'), false);
  assert.equal(first.items.every((item) => item.headhunter === undefined), true);
});

test('getHeadhunterProjects is cached 60 s per handle and page under the projects, headhunters and headhunter:<handle> tags', async () => {
  const { module, cached } = minisiteWorld();
  await module.getHeadhunterProjects('hh1', 'agency-one', 2);
  const entry = cached.find(({ keys }) => keys[0] === 'headhunter-projects');
  assert.deepEqual(plain(entry.keys), ['headhunter-projects', 'agency-one', '2']);
  assert.equal(entry.options.revalidate, 60);
  assert.deepEqual(plain(entry.options.tags), ['projects', 'headhunters', 'headhunter:agency-one']);
});

// ---------------------------------------------------------------------------------------------
// Route decision (src/lib/headhunters/minisite.ts)
// ---------------------------------------------------------------------------------------------

const minisite = loadModule('src/lib/headhunters/minisite.ts', { env });
function deps(overrides = {}) {
  const calls = { enabled: 0, lookup: [], account: [], projects: [] };
  const record = liveRecord('hh1', { handle: 'acme-hr', displayName: 'Acme HR' });
  const value = {
    enabled: async () => { calls.enabled += 1; return true; },
    lookup: async (handle) => { calls.lookup.push(handle); return handle === 'acme-hr' ? { kind: 'active', record } : handle === 'old-name' ? { kind: 'redirect', to: 'acme-hr' } : null; },
    accountActive: async (uid) => { calls.account.push(uid); return true; },
    projects: async (uid, handle, page) => { calls.projects.push([uid, handle, page]); return { openCount: 30, publishedCount: 40, items: [], closed: [] }; },
    ...overrides,
  };
  return { calls, value, record };
}
const decide = (handle, page, d) => minisite.resolveMinisite(handle, page, d.value);

test('resolver: bad handle formats and bad pages are 404 without any read', async () => {
  const d = deps();
  for (const handle of ['.env', 'a', 'ab', '-abc', 'abc-', 'a--b', 'robots.txt', 'x'.repeat(31), 'שלום', 'a b', '']) assert.deepEqual(plain(await decide(handle, undefined, d)), { kind: 'not-found' }, handle);
  for (const page of ['0', '-1', '2.5', '01', 'abc', ['1', '2']]) assert.deepEqual(plain(await decide('acme-hr', page, d)), { kind: 'not-found' }, String(page));
  assert.deepEqual([d.calls.enabled, d.calls.lookup.length, d.calls.account.length, d.calls.projects.length], [0, 0, 0, 0]);
});

test('resolver: upper-case handle is a 308 target to the lower-case URL, without a database read', async () => {
  const d = deps();
  assert.deepEqual(plain(await decide('Acme-HR', undefined, d)), { kind: 'redirect', to: '/acme-hr' });
  assert.deepEqual(plain(await decide('ACME-HR', '3', d)), { kind: 'redirect', to: '/acme-hr?page=3' });
  assert.equal(d.calls.lookup.length, 0);
});

test('resolver: a retired handle redirects to the owner’s current handle (one hop); unknown or target-less is 404', async () => {
  const d = deps();
  assert.deepEqual(plain(await decide('old-name', undefined, d)), { kind: 'redirect', to: '/acme-hr' });
  assert.deepEqual(plain(await decide('old-name', '2', d)), { kind: 'redirect', to: '/acme-hr?page=2' });
  assert.deepEqual(plain(await decide('nobody-here', undefined, d)), { kind: 'not-found' });
  const broken = deps({ lookup: async () => ({ kind: 'redirect', to: '../evil' }) });
  assert.deepEqual(plain(await decide('old-name', undefined, broken)), { kind: 'not-found' });
});

test('resolver: feature off, not approved, not eligible or restricted account is a real 404', async () => {
  assert.deepEqual(plain(await decide('acme-hr', undefined, deps({ enabled: async () => false }))), { kind: 'not-found' });
  for (const status of ['draft', 'pending', 'suspended', 'rejected']) {
    const d = deps({ lookup: async () => ({ kind: 'active', record: liveRecord('hh1', { handle: 'acme-hr', status }) }) });
    assert.deepEqual(plain(await decide('acme-hr', undefined, d)), { kind: 'not-found' }, status);
    assert.equal(d.calls.projects.length, 0, 'no project read for a page that is not live');
  }
  const ineligible = deps({ lookup: async () => ({ kind: 'active', record: liveRecord('hh1', { handle: 'acme-hr', eligibleAt: undefined }) }) });
  assert.deepEqual(plain(await decide('acme-hr', undefined, ineligible)), { kind: 'not-found' });
  const restricted = deps({ accountActive: async () => false });
  assert.deepEqual(plain(await decide('acme-hr', undefined, restricted)), { kind: 'not-found' });
  assert.equal(restricted.calls.projects.length, 0);
});

test('resolver: a live page renders public fields only; the page number is checked against the open count', async () => {
  const d = deps();
  const page = await decide('acme-hr', undefined, d);
  assert.equal(page.kind, 'page');
  assert.equal(page.totalPages, 2);
  assert.equal(page.state.live, true);
  assert.equal(page.state.indexable, true);
  assert.deepEqual(d.calls.projects, [['hh1', 'acme-hr', 1]]);
  assert.deepEqual(Object.keys(page.view).sort(), ['about', 'city', 'contact', 'displayName', 'handle', 'kind', 'share', 'tagline']);
  assert.doesNotMatch(JSON.stringify(page.view), /hh1|ownerUid|counters|flags|reviewReason|lookalike|internal note|version|eligibleAt/);
  assert.equal((await decide('acme-hr', '2', d)).kind, 'page');
  assert.deepEqual(plain(await decide('acme-hr', '3', d)), { kind: 'not-found' });
});

test('resolver: no open projects is a live but noindex page with a single (empty) page 1', async () => {
  const d = deps({ projects: async () => ({ openCount: 0, publishedCount: 12, items: [], closed: [] }) });
  const page = await decide('acme-hr', undefined, d);
  assert.deepEqual([page.kind, page.state.live, page.state.indexable, page.totalPages], ['page', true, false, 1]);
  assert.deepEqual(plain(await decide('acme-hr', '2', d)), { kind: 'not-found' });
  const meta = minisite.minisiteMetadata(page);
  assert.equal(meta.robots.index, false);
});

test('metadata: share title and description, canonical /handle, indexable only with open projects, later pages noindex', async () => {
  const d = deps();
  const page1 = minisite.minisiteMetadata(await decide('acme-hr', undefined, d));
  assert.equal(page1.title.absolute, 'Acme HR | Freelance Place');
  assert.match(page1.description, /We place developers/);
  assert.equal(page1.alternates.canonical, `${SITE}/acme-hr`);
  assert.equal(page1.robots.index, true);
  const page2 = minisite.minisiteMetadata(await decide('acme-hr', '2', d));
  assert.equal(page2.alternates.canonical, `${SITE}/acme-hr?page=2`);
  assert.equal(page2.robots.index, false);
  assert.equal(minisite.minisiteMetadata({ kind: 'not-found' }).robots.index, false);
});

test('metadata: a custom share title and description win; the generated ones are the fallback', async () => {
  const record = liveRecord('hh1', { handle: 'acme-hr', displayName: 'Acme HR', share: { title: 'Custom title', description: 'Custom description' } });
  const d = deps({ lookup: async () => ({ kind: 'active', record }) });
  const meta = minisite.minisiteMetadata(await decide('acme-hr', undefined, d));
  assert.equal(meta.title.absolute, 'Custom title');
  assert.equal(meta.description, 'Custom description');
});

// ---------------------------------------------------------------------------------------------
// Page and components
// ---------------------------------------------------------------------------------------------

function loadPage({ lookup, projects, enabled = true, accountActive = true } = {}) {
  const redirects = [];
  const record = liveRecord('hh1', { handle: 'acme-hr', displayName: 'Acme HR' });
  const data = { openCount: 2, publishedCount: 5, items: [project({ title: 'פרויקט פתוח א' }), project({ title: 'פרויקט פתוח ב' })].map((item, index) => ({ slug: `open-${index}`, title: item.title, category: 'פיתוח אתרים', budget: '₪1,000', description: item.description, skills: ['React'], status: 'open' })), closed: [{ slug: 'closed-1', title: 'פרויקט שנסגר', status: 'closed' }] };
  const page = loadModule('src/app/[handle]/page.tsx', { env, stubs: {
    ...ui,
    'next/navigation': { notFound() { throw Object.assign(new Error('NEXT_NOT_FOUND'), NOT_FOUND); }, permanentRedirect(to) { redirects.push(to); throw Object.assign(new Error('NEXT_REDIRECT'), { digest: 'NEXT_REDIRECT' }); } },
    '@/components/discovery/public-content': { PublicHeader: () => createElement('header', { id: 'public-header' }) },
    '@/lib/db/headhunters': { getHeadhunterConfig: async () => ({ enabled }), getHeadhunterByHandle: lookup ?? (async (handle) => (handle === 'acme-hr' ? { kind: 'active', record } : handle === 'old-name' ? { kind: 'redirect', to: 'acme-hr' } : null)), isAccountActive: async () => accountActive },
    '@/lib/db/projects': { getHeadhunterProjects: projects ?? (async () => data) },
  } });
  return { page, redirects };
}
const route = (handle, page) => ({ params: Promise.resolve({ handle }), searchParams: Promise.resolve(page === undefined ? {} : { page }) });

test('page: 404 and 308 decisions reach Next through notFound and permanentRedirect', async () => {
  const { page, redirects } = loadPage();
  await assert.rejects(page.default(route('unknown-handle')), NOT_FOUND);
  await assert.rejects(page.default(route('.env')), NOT_FOUND);
  await assert.rejects(page.default(route('acme-hr', '9')), NOT_FOUND);
  await assert.rejects(page.default(route('Acme-HR')), { digest: 'NEXT_REDIRECT' });
  await assert.rejects(page.default(route('old-name', '2')), { digest: 'NEXT_REDIRECT' });
  assert.deepEqual(redirects, ['/acme-hr', '/acme-hr?page=2']);
  const off = loadPage({ enabled: false });
  await assert.rejects(off.page.default(route('acme-hr')), NOT_FOUND);
  assert.equal((await off.page.generateMetadata(route('acme-hr'))).robots.index, false);
});

test('page: discovery layout with breadcrumb, hero, contact links, open cards, closed titles and the footer note; nothing non-public', async () => {
  const { page } = loadPage();
  const html = renderToStaticMarkup(await page.default(route('acme-hr')));
  assert.match(html, /id="public-header"/);
  assert.match(html, /<main class="discovery-content hh-site">/);
  assert.match(html, /<nav class="disc-crumbs"[^>]*><ol><li><a href="\/">דף הבית<\/a><\/li><li><span aria-current="page">Acme HR<\/span><\/li><\/ol><\/nav>/);
  assert.match(html, /<h1 id="hh-name">Acme HR<\/h1>/);
  assert.match(html, /סוכנות גיוס · Tel Aviv/);
  assert.match(html, /<p class="hh-about">First paragraph\.<\/p><p class="hh-about">Second paragraph\.<\/p>/);
  assert.match(html, /<dd>2<\/dd>/); assert.match(html, /<dd>5<\/dd>/);
  assert.match(html, /<ul class="disc-cards">/);
  assert.match(html, /אין כרגע פרויקטים פתוחים|פרויקטים פתוחים/);
  assert.match(html, /<span>פרויקט שנסגר<\/span><span class="project-closed-badge">נסגר<\/span>/);
  assert.doesNotMatch(html, /closed-1/, 'closed projects have no public page, so nothing links to them');
  assert.match(html, /העמוד מנוהל על ידי Acme HR/);
  // Contact: internal schemes are plain links, external ones open safely.
  assert.match(html, /<a href="mailto:jobs@acme\.example">/);
  assert.match(html, /<a href="tel:\+972-3-555-0100">/);
  for (const href of ['https://acme.example', 'https://wa.me/972501234567', 'https://www.linkedin.com/company/acme']) assert.ok(html.includes(`<a href="${href}" target="_blank" rel="nofollow noopener noreferrer">`), href);
  // The CTA to message the headhunter is not offered: there is no way to message a user from a public page yet.
  assert.doesNotMatch(html, /שליחת הודעה בפלטפורמה/);
  // Nothing non-public reaches the HTML.
  assert.doesNotMatch(html, /hh1|ownerUid|lookalike|internal note|reviewReason|counters|version/);
});

test('page: the empty state and the second page', async () => {
  const empty = loadPage({ projects: async () => ({ openCount: 0, publishedCount: 3, items: [], closed: [] }) });
  const emptyHtml = renderToStaticMarkup(await empty.page.default(route('acme-hr')));
  assert.match(emptyHtml, /<p class="hh-empty">אין כרגע פרויקטים פתוחים<\/p>/);
  assert.doesNotMatch(emptyHtml, /disc-cards/);
  assert.equal((await empty.page.generateMetadata(route('acme-hr'))).robots.index, false);
  const many = loadPage({ projects: async () => ({ openCount: 30, publishedCount: 30, items: [{ slug: 'x', title: 'עמוד שני', category: 'כללי', budget: '₪1', description: 'תיאור', skills: [], status: 'open' }], closed: [{ slug: 'c', title: 'סגור', status: 'closed' }] }) });
  const second = renderToStaticMarkup(await many.page.default(route('acme-hr', '2')));
  assert.match(second, /<a href="\/acme-hr" rel="prev">הקודם<\/a>/);
  assert.match(second, /aria-current="page" aria-label="עמוד 2, העמוד הנוכחי"/);
  assert.doesNotMatch(second, /נסגר/, 'the closed list is on page 1 only');
  const first = renderToStaticMarkup(await many.page.default(route('acme-hr')));
  assert.match(first, /<a href="\/acme-hr\?page=2" rel="next">הבא<\/a>/);
});

test('the tag is one link to the minisite with an accessible name, a split pill and an ltr address', () => {
  const { HeadhunterTag } = loadModule('src/components/headhunter-tag.tsx', { env, stubs: ui });
  const html = renderToStaticMarkup(createElement(HeadhunterTag, { headhunter: { name: 'אופק גיוס', handle: 'ofek-hr' } }));
  assert.match(html, /^<a href="\/ofek-hr" class="hh-tag" aria-label="פרויקט של אופק גיוס, לעמוד הסוכנות">/);
  assert.match(html, /<span class="hh-tag-name"><svg[^>]*aria-hidden="true"[^>]*>.*<\/svg><bdi>אופק גיוס<\/bdi><\/span>/);
  assert.match(html, /<span class="hh-tag-url" dir="ltr"><span class="hh-host">freelance-place\.com<\/span>\/ofek-hr<\/span>/);
  assert.equal((html.match(/<a /g) ?? []).length, 1);
  assert.equal((html.match(/<button/g) ?? []).length, 0);
});

test('discovery cards and the marketplace card show the tag only for tagged projects', () => {
  const { ProjectCardList } = loadModule('src/components/discovery/project-cards.tsx', { env, stubs: ui });
  const base = { title: 'פרויקט', category: 'פיתוח אתרים', budget: '₪1', description: 'תיאור', skills: [] };
  const html = renderToStaticMarkup(createElement(ProjectCardList, { projects: [{ ...base, slug: 'a', headhunter: { name: 'Acme', handle: 'acme-hr' } }, { ...base, slug: 'b' }], skills: [] }));
  assert.equal((html.match(/class="hh-tag"/g) ?? []).length, 1);
  assert.match(html, /<li class="disc-card"><p class="disc-card-tags"><span class="live-badge"[^>]*>.*?<\/span><a href="\/acme-hr" class="hh-tag"/);
});

test('the feed card renders the tag beside the expand button, never inside a button', () => {
  const source = loadModule('src/components/workspace-home.tsx', { env: { ...env }, stubs: {
    ...ui,
    'next/dynamic': { __esModule: true, default: () => () => null },
    './view-mode': { useViewMode: () => ({ mode: 'freelancer', setMode: () => {} }) },
    './my-applications': { MyApplications: () => null }, '@/components/trial-status': { TrialStatus: () => null }, '@/components/auth-control': { AuthControl: () => null },
    './account-safety': { AccountSafetyNotice: () => null },
    '@/components/viewer-context': { ViewerProvider: ({ children }) => children, useViewer: () => ({ status: 'signed-out', user: null }) },
    '@/components/project-description': { ProjectDescription: ({ text }) => createElement('p', null, text) },
  } });
  const initialProjects = [
    { slug: 'tagged', title: 'פרויקט מתויג', category: 'עיצוב', description: 'תיאור', budget: '₪1', deadline: 'גמיש', posted: 'לפני שעה', client: 'לקוח', clientHistory: '', skills: [], proposals: 0, status: 'open', createdAt: 5, fit: '', activity: '', headhunter: { name: 'Acme', handle: 'acme-hr' } },
    { slug: 'plain', title: 'פרויקט רגיל', category: 'עיצוב', description: 'תיאור', budget: '₪1', deadline: 'גמיש', posted: 'לפני שעה', client: 'לקוח', clientHistory: '', skills: [], proposals: 0, status: 'open', createdAt: 4, fit: '', activity: '', },
  ];
  const html = renderToStaticMarkup(createElement(source.default, { initialProjects }));
  const cards = html.split('<article ').slice(1).filter((card) => /פרויקט (מתויג|רגיל)/.test(card));
  const tagged = cards.find((card) => card.includes('פרויקט מתויג'));
  const untagged = cards.find((card) => card.includes('פרויקט רגיל'));
  assert.match(tagged, /project-summary has-page-link has-hh-tag/);
  assert.ok(tagged.indexOf('class="hh-tag"') < tagged.indexOf('class="expand-project"'), 'the tag row comes before the expand button in the DOM');
  const button = tagged.slice(tagged.indexOf('<button class="expand-project"'), tagged.indexOf('</button>', tagged.indexOf('<button class="expand-project"')));
  assert.doesNotMatch(button, /<a /, 'no link inside the expand button');
  assert.doesNotMatch(button, /project-category/, 'the category row moved out with the tag, so it is not rendered twice');
  assert.equal((tagged.match(/עיצוב/g) ?? []).length, 1);
  assert.doesNotMatch(untagged, /hh-tag/);
  assert.match(untagged, /<button class="expand-project"[^>]*><div class="project-category">/, 'an untagged card is unchanged');
});

// ---------------------------------------------------------------------------------------------
// Project detail page
// ---------------------------------------------------------------------------------------------

function loadDetail(current, { items = [], lookup } = {}) {
  const requested = [];
  const record = liveRecord('hh1', { handle: 'acme-hr' });
  const page = loadModule('src/app/projects/[slug]/page.tsx', { env, stubs: {
    ...ui,
    'next/navigation': { notFound() { throw Object.assign(new Error('NEXT_NOT_FOUND'), NOT_FOUND); } },
    '@/components/marketplace': { AppShell: ({ children }) => createElement('div', null, children), OpportunitySignal: () => null, PageHeading: ({ eyebrow, title }) => createElement('div', null, createElement('p', null, eyebrow), createElement('h1', null, title)) },
    '@/components/actions': { ProposalAction: () => null },
    '@/components/project-description': { ProjectDescription: ({ text }) => createElement('p', null, text) },
    '@/lib/seo/projects': { readPublicProject: async () => current, discoveryProjects: async () => [] },
    '@/lib/db/headhunters': { getHeadhunterByHandle: lookup ?? (async () => ({ kind: 'active', record })) },
    '@/lib/db/projects': { getHeadhunterProjects: async (uid, handle, pageNumber) => { requested.push([uid, handle, pageNumber]); return { openCount: items.length, publishedCount: items.length, items, closed: [] }; } },
  } });
  return { page, requested };
}
const detailProject = (extra = {}) => ({ slug: 'current', title: 'הפרויקט הנוכחי', category: 'פיתוח אתרים', description: 'תיאור', budget: '₪1', deadline: 'גמיש', posted: 'חדש', client: 'לקוח', clientHistory: '', skills: ['React'], proposals: 0, status: 'open', fit: '', activity: '', ...extra });
const sibling = (index) => ({ slug: `other-${index}`, title: `פרויקט אחר ${index}`, category: 'פיתוח אתרים', budget: '₪1', description: 'תיאור', skills: [], status: 'open' });

test('project page: a tagged project shows the tag and up to three other open projects of that headhunter, with a link to all', async () => {
  const { page, requested } = loadDetail(detailProject({ headhunter: { name: 'Acme', handle: 'acme-hr' } }), { items: [sibling(0), { ...sibling(9), slug: 'current' }, sibling(1), sibling(2), sibling(3)] });
  const html = renderToStaticMarkup(await page.default({ params: Promise.resolve({ slug: 'current' }) }));
  assert.match(html, /<p>פיתוח אתרים<span class="live-badge"[^>]*>.*?<\/span><a href="\/acme-hr" class="hh-tag"/, 'the tag sits in the eyebrow row beside the category (after LIVE)');
  assert.match(html, /<h2 id="headhunter-more-heading">עוד פרויקטים מAcme<\/h2>/);
  assert.deepEqual([...html.matchAll(/href="\/projects\/(other-\d)"/g)].map((match) => match[1]), ['other-0', 'other-1', 'other-2'], 'three others, the current project left out');
  assert.match(html, /<a href="\/acme-hr">כל הפרויקטים<\/a>/);
  assert.deepEqual(requested, [['hh1', 'acme-hr', 1]]);
  assert.doesNotMatch(html, /hh1|ownerUid/);
});

test('project page: no tag means no block and no headhunter read; a block with nothing to show or a failed read is left out', async () => {
  const plainPage = loadDetail(detailProject(), { items: [sibling(0)] });
  const plainHtml = renderToStaticMarkup(await plainPage.page.default({ params: Promise.resolve({ slug: 'current' }) }));
  assert.doesNotMatch(plainHtml, /headhunter-more-heading|hh-tag/);
  assert.deepEqual(plainPage.requested, []);
  const tagged = detailProject({ headhunter: { name: 'Acme', handle: 'acme-hr' } });
  const alone = loadDetail(tagged, { items: [{ ...sibling(9), slug: 'current' }] });
  assert.doesNotMatch(renderToStaticMarkup(await alone.page.default({ params: Promise.resolve({ slug: 'current' }) })), /headhunter-more-heading/);
  const failing = loadDetail(tagged, { lookup: async () => { throw new Error('down'); } });
  const warn = console.warn; console.warn = () => {};
  try { assert.doesNotMatch(renderToStaticMarkup(await failing.page.default({ params: Promise.resolve({ slug: 'current' }) })), /headhunter-more-heading/); } finally { console.warn = warn; }
  const retired = loadDetail(tagged, { lookup: async () => null });
  assert.doesNotMatch(renderToStaticMarkup(await retired.page.default({ params: Promise.resolve({ slug: 'current' }) })), /headhunter-more-heading/);
});
