import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { Timestamp } from 'firebase-admin/firestore';
registerHooks({ resolve(specifier, context, next) {
  if (specifier === 'server-only') return { url: 'data:text/javascript,export{}', shortCircuit: true };
  if (specifier.startsWith('@/')) return next(new URL('../src/' + specifier.slice(2) + '.ts', import.meta.url).href, context);
  if (specifier === 'next/server' || specifier === 'next/headers') return next(specifier + '.js', context);
  return next(specifier, context);
} });
const rows = new Map();
const field = (data, key) => String(key) === '__name__' ? data.id : String(key).split('.').reduce((o, k) => o?.[k], data);
const snap = path => ({ id: path.split('/').at(-1), ref: ref(path), exists: rows.has(path), data: () => rows.get(path), get: key => field(rows.get(path), key) });
function apply(path, patch, merge = true) {
  const value = merge ? { ...rows.get(path) } : {};
  for (const [key, val] of Object.entries(patch)) {
    const keys = key.split('.');
    if (keys.length === 2) value[keys[0]] = { ...value[keys[0]], [keys[1]]: val }; else value[key] = val;
  }
  rows.set(path, value);
}
function ref(path) { return { id: path.split('/').at(-1), path, get: async () => snap(path), update: async patch => apply(path, patch) }; }
function query(name, filters = [], orders = [], cursor = null, max = Infinity) {
  return { doc: id => ref(`${name}/${id}`), where: (...f) => query(name, [...filters, f], orders, cursor, max), orderBy: f => query(name, filters, [...orders, String(f)], cursor, max), startAfter: (...v) => query(name, filters, orders, v, max), limit: n => query(name, filters, orders, cursor, n), get: async () => {
    const number = v => v?.toMillis?.() ?? v;
    const compare = (a, b) => number(a) < number(b) ? -1 : number(a) > number(b) ? 1 : 0;
    let docs = [...rows.keys()].filter(path => path.startsWith(name + '/') && path.split('/').length === 2).map(snap).filter(doc => filters.every(([f, op, v]) => { const n = compare(doc.get(f), v); return op === '==' ? n === 0 : op === '>' ? n > 0 : n <= 0; }));
    const value = (doc, f) => f === '__name__' ? doc.id : doc.get(f);
    docs.sort((a, b) => { for (const f of orders) { const n = compare(value(a, f), value(b, f)); if (n) return n; } return 0; });
    if (cursor) docs = docs.filter(doc => { for (let i = 0; i < cursor.length; i++) { const n = compare(value(doc, orders[i]), cursor[i]); if (n) return n > 0; } return false; });
    docs = docs.slice(0, max); return { docs, size: docs.length };
  } };
}
let tail = Promise.resolve();
const db = { collection: name => query(name), runTransaction(fn) {
  const result = tail.then(async () => { const writes = []; const tx = { get: async r => { assert.equal(writes.length, 0); return snap(r.path); }, set: (r, v, options) => writes.push(() => apply(r.path, v, options?.merge)), update: (r, v) => writes.push(() => apply(r.path, v)) }; const v = await fn(tx); writes.forEach(w => w()); return v; });
  tail = result.catch(() => {}); return result;
} };
let user, identity, sends = [], failSend = false;
await mock.module('../src/lib/db/firestore.ts', { namedExports: { firestore: () => db } });
await mock.module('../src/lib/auth/session.ts', { namedExports: { getCurrentUser: async () => user, isSameOrigin: r => r.headers.get('origin') === 'https://example.com', publicAppOrigin: () => 'https://example.com' } });
await mock.module('../src/lib/auth/firebase-admin.ts', { namedExports: { adminAuth: () => ({ getUser: async () => identity }) } });
await mock.module('resend', { namedExports: { Resend: class { emails = { send: async (payload, opts) => { sends.push({ payload, opts }); return failSend ? { error: { message: 'timeout' } } : { data: { id: 'mail-id' } }; } }; } } });
await mock.module('google-auth-library', { namedExports: { OAuth2Client: class { async verifyIdToken({ idToken, audience }) { assert.equal(audience, 'https://example.com/api/notifications/dispatch'); return { getPayload: () => ({ email: idToken, email_verified: true }) }; } } } });
const rules = await import('../src/lib/notifications/preferences.ts');
const api = await import('../src/app/api/marketplace/mail-preferences/route.ts');
const unsubscribe = await import('../src/app/api/notifications/unsubscribe/route.ts');
const worker = await import('../src/lib/notifications/delivery.ts');
const dispatch = await import('../src/app/api/notifications/dispatch/route.ts');
const now = Date.now();
const profile = { profileType: 'freelancer', name: 'Test', headline: 'Developer', skills: ['React', 'Figma'] };
const pref = { enabled: true, interval: 'project', tags: ['React'], minBudget: '2000' };
function setup() {
  rows.clear(); sends = []; failSend = false; user = { uid: 'user1', email: 'session@example.com' }; identity = { email: 'verified@example.com', emailVerified: true, disabled: false };
  rows.set('profiles/user1', { ...profile });
  Object.assign(process.env, { RESEND_API_KEY: 'test-only', PROJECT_NOTIFICATIONS_FROM_EMAIL: 'Projects <projects@example.com>', PROJECT_NOTIFICATIONS_ENABLED: 'true', NEXT_PUBLIC_SITE_URL: 'https://example.com', NOTIFICATIONS_SCHEDULER_EMAIL: 'scheduler@example.com' });
}
function request(body, origin = 'https://example.com') { return new Request('https://example.com/api/marketplace/mail-preferences', { method: 'PUT', headers: { origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); }
function subscribe(patch = {}) { rows.set('projectMailPreferences/user1', { ...pref, revision: 'rev1', unsubscribeToken: 'a'.repeat(64), cursor: Timestamp.fromMillis(now - 3600000), ...patch }); }
function project(id, patch = {}) { rows.set(`projects/${id}`, { title: '<React project>', description: 'Build a React website', skills: ['React'], budget: '₪3,000–5,000', status: 'open', ownerUid: 'client', createdAt: Timestamp.fromMillis(now - 120000), ...patch }); }

test('eligibility, profile tag defaults and strict preference validation', () => {
  assert.equal(rules.eligibleProfile(profile), true);
  assert.equal(rules.eligibleProfile({ ...profile, profileType: 'publisher' }), false);
  assert.equal(rules.eligibleProfile({ ...profile, skills: [] }), false);
  assert.deepEqual(rules.defaultPreferences(profile).tags, ['React', 'Figma']);
  for (const bad of [{ ...pref, minBudget: '-1' }, { ...pref, minBudget: 'Infinity' }, { ...pref, tags: [12] }, { ...pref, interval: 'hourly' }]) assert.equal(rules.parsePreferences(bad), null);
});
test('matching excludes own, synthetic, closed, private, irrelevant and unknown budget projects', () => {
  setup(); project('p'); const p = rows.get('projects/p');
  assert.equal(rules.matchesProject(p, 'user1', pref), true);
  for (const patch of [{ ownerUid: 'user1' }, { sample: true }, { unreal: true }, { status: 'closed' }, { visibility: 'private' }, { skills: ['Python'], title: 'Python', description: 'Python' }, { budget: 'לפי שעה' }, { budget: '₪1,000–5,000' }]) assert.equal(rules.matchesProject({ ...p, ...patch }, 'user1', pref), false);
  assert.equal(rules.budgetFloor('₪2,000–4,000'), 2000);
  assert.equal(rules.dailyDue(Date.parse('2026-11-11T07:59:00Z')), false);
  assert.equal(rules.dailyDue(Date.parse('2026-11-11T08:00:00Z'), '2026-11-10'), true);
  assert.equal(rules.dailyDue(Date.parse('2026-11-11T12:00:00Z'), '2026-11-11'), false);
});
test('API requires login, origin, complete freelancer and verified auth identity', async () => {
  setup(); user = null; assert.equal((await api.GET()).status, 401);
  user = { uid: 'user1' }; assert.equal((await api.PUT(request(pref, 'https://evil.test'))).status, 403);
  assert.deepEqual((await (await api.GET()).json()).preferences.tags, profile.skills);
  rows.set('profiles/user1', { ...profile, headline: '' }); assert.equal((await (await api.GET()).json()).eligible, false);
  assert.equal((await api.PUT(request(pref))).status, 403);
  rows.set('profiles/user1', profile); identity.emailVerified = false; assert.equal((await api.PUT(request(pref))).status, 403);
  identity.emailVerified = true; assert.equal((await api.PUT(request({ ...pref, minBudget: '-1' }))).status, 400);
  assert.equal((await api.PUT(request(pref))).status, 200);
  const saved = rows.get('projectMailPreferences/user1'); assert.equal(saved.email, undefined); assert.equal(saved.unsubscribeToken.length, 64);
  const cursor = saved.cursor; await api.PUT(request(pref)); assert.equal(rows.get('projectMailPreferences/user1').cursor, cursor);
  process.env.PROJECT_NOTIFICATIONS_ENABLED = 'false'; assert.equal((await api.PUT(request(pref))).status, 503);
  assert.equal((await api.PUT(request({ ...pref, enabled: false }))).status, 200);
});
test('worker sends only matching projects to current auth email, escapes HTML and checkpoints', async () => {
  setup(); subscribe(); project('a'); project('b', { sample: true }); project('c', { ownerUid: 'user1' });
  const result = await worker.dispatchNotifications(); assert.equal(result.failed, 0); assert.equal(sends.length, 1);
  assert.equal(sends[0].payload.to, 'verified@example.com'); assert.ok(sends[0].payload.html.includes('&lt;React project&gt;'));
  assert.ok(sends[0].payload.headers['List-Unsubscribe']);
  await worker.dispatchNotifications(); assert.equal(sends.length, 1);
});
test('failed provider sends retain frozen batch/key and cursor for safe retry', async () => {
  setup(); subscribe(); project('a'); failSend = true;
  const cursor = rows.get('projectMailPreferences/user1').cursor;
  assert.equal((await worker.dispatchNotifications()).failed, 1);
  assert.equal(rows.get('projectMailPreferences/user1').cursor, cursor);
  const key = sends[0].opts.idempotencyKey; failSend = false;
  await worker.dispatchNotifications(); assert.equal(sends[1].opts.idempotencyKey, key);
  assert.equal(rows.get('projectMailPreferences/user1').pending, null);
});
test('daily batching, no replay, incomplete-profile suppression, and stale batch quarantine', async () => {
  setup(); subscribe({ interval: 'daily', pending: null }); project('a'); project('b');
  // Force a due daily run independently of the machine's current hour.
  const time = mock.method(Date, 'now', () => Date.parse(new Date(now).toISOString().slice(0, 10) + 'T20:00:00Z') + 86400000);
  await worker.dispatchNotifications(); assert.equal(sends.length, 1); assert.ok(sends[0].payload.text.includes('/projects/a')); assert.ok(sends[0].payload.text.includes('/projects/b'));
  await worker.dispatchNotifications(); assert.equal(sends.length, 1); time.mock.restore();
  setup(); subscribe(); project('a'); rows.set('profiles/user1', { ...profile, profileType: 'publisher' }); await worker.dispatchNotifications(); assert.equal(sends.length, 0); assert.equal(rows.get('projectMailPreferences/user1').enabled, false);
  setup(); subscribe(); project('a'); failSend = true; await worker.dispatchNotifications();
  rows.get('projectMailPreferences/user1').pending.created = Date.now() - 24 * 3600000;
  failSend = false; await worker.dispatchNotifications(); assert.equal(sends.length, 1); assert.equal(rows.get('projectMailPreferences/user1').reviewRequired, true);
});
test('equal timestamps paginate by id without skipping, scheduler requires OIDC, concurrent lease excludes overlap', async () => {
  setup(); subscribe(); for (let i = 0; i < 22; i++) project('p' + String(i).padStart(2, '0'), { sample: true });
  project('p21'); await worker.dispatchNotifications(); assert.equal(sends.length, 0); await worker.dispatchNotifications(); assert.equal(sends.length, 1);
  assert.equal((await dispatch.POST(new Request('https://example.com/api/notifications/dispatch', { method: 'POST' }))).status, 401);
  const results = await Promise.all([worker.dispatchNotifications(), worker.dispatchNotifications()]); assert.ok(results.some(r => r.busy));
});
test('unsubscribe GET is non-mutating; authenticated token POST disables pending delivery', async () => {
  setup(); subscribe(); const url = 'https://example.com/api/notifications/unsubscribe?uid=user1&token=' + 'a'.repeat(64);
  assert.equal((await unsubscribe.GET(new Request(url))).status, 200); assert.equal(rows.get('projectMailPreferences/user1').enabled, true);
  assert.equal((await unsubscribe.POST(new Request(url.replace('token=a', 'token=b'), { method: 'POST' }))).status, 400);
  assert.equal((await unsubscribe.POST(new Request(url, { method: 'POST' }))).status, 200); assert.equal(rows.get('projectMailPreferences/user1').enabled, false);
  assert.equal((await unsubscribe.POST(new Request(url, { method: 'POST' }))).status, 200);
});
