import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { NextResponse } from 'next/server.js';
import { loadModule } from './helpers/load-ts.mjs';
import { createFakeFirestore, DELETE_FIELD } from './helpers/fake-firestore.mjs';

// The "live now" (fast-track) option: the 40-hour window, the visibility rule on every surface, apply and approval.

const SITE = 'https://freelance-place.com';
const env = { SITE_INDEXABLE: 'true', NEXT_PUBLIC_SITE_URL: SITE };
const plain = (value) => JSON.parse(JSON.stringify(value));
const constants = loadModule('src/lib/headhunters/constants.ts', { env });
const trial = loadModule('src/lib/headhunters/trial.ts', { env });
const state = loadModule('src/lib/headhunters/state.ts', { env });
const minisite = loadModule('src/lib/headhunters/minisite.ts', { env });
const view = loadModule('src/lib/headhunters/view.ts', { env });
const counter = loadModule('src/lib/headhunters/counter.ts', { env });
const HOURS = constants.HEADHUNTER_FAST_TRACK_HOURS;
const HOUR = 3_600_000;
const T0 = Date.UTC(2026, 10, 22, 8, 0, 0);

test('the window is 40 hours and the constant is the single source', () => {
  assert.equal(HOURS, 40);
  assert.equal(trial.trialEndsAtFrom(T0), T0 + 40 * HOUR);
});

// ---------------------------------------------------------------------------------------------
// trialPhase: the clock edges
// ---------------------------------------------------------------------------------------------

const input = (over = {}) => ({ status: 'approved', fastTrack: true, eligible: false, trialEndsAt: T0 + HOURS * HOUR, ...over });

test('trialPhase: running before the end, expired at and after it', () => {
  const end = T0 + HOURS * HOUR;
  assert.equal(trial.trialPhase(input(), T0), 'running');
  assert.equal(trial.trialPhase(input(), end - 1), 'running', '1 ms before 40h');
  assert.equal(trial.trialPhase(input(), end), 'expired', 'exactly at 40h the page is down');
  assert.equal(trial.trialPhase(input(), end + 1), 'expired');
  assert.equal(trial.trialPhase(input(), end + 30 * 24 * HOUR), 'expired');
});

test('trialPhase: standard records, waiting records, met threshold and a missing end time', () => {
  assert.equal(trial.trialPhase(input({ fastTrack: undefined }), T0), 'none');
  assert.equal(trial.trialPhase(input({ fastTrack: false }), T0), 'none');
  assert.equal(trial.trialPhase(input({ fastTrack: 'yes' }), T0), 'none', 'only a literal true counts');
  for (const status of ['draft', 'pending', 'rejected', 'suspended']) assert.equal(trial.trialPhase(input({ status, trialEndsAt: null }), T0), 'waiting', status);
  assert.equal(trial.trialPhase(input({ eligible: true }), T0 + 1000 * HOUR), 'met', 'the threshold wins over the clock');
  for (const trialEndsAt of [null, undefined, Number.NaN, '2026-11-24']) assert.equal(trial.trialPhase(input({ trialEndsAt }), T0), 'expired', `fails closed: ${trialEndsAt}`);
});

test('trialHoursLeft rounds up and is 0 once closed', () => {
  const end = T0 + HOURS * HOUR;
  assert.equal(trial.trialHoursLeft(end, T0), 40);
  assert.equal(trial.trialHoursLeft(end, T0 + HOUR), 39);
  assert.equal(trial.trialHoursLeft(end, end - 1), 1);
  assert.equal(trial.trialHoursLeft(end, end), 0);
  assert.equal(trial.trialHoursLeft(null, T0), 0);
});

// ---------------------------------------------------------------------------------------------
// headhunterPublicState
// ---------------------------------------------------------------------------------------------

test('headhunterPublicState: a running trial is live but never indexable; the standard cases are unchanged', () => {
  const run = (over) => plain(state.headhunterPublicState({ status: 'approved', eligible: false, accountActive: true, openProjects: 5, ...over }));
  assert.deepEqual(run({ trialRunning: true }), { live: true, indexable: false, reason: 'trial' });
  assert.deepEqual(run({ trialRunning: true, openProjects: 0 }), { live: true, indexable: false, reason: 'trial' });
  assert.deepEqual(run({ trialRunning: false }), { live: false, indexable: false, reason: 'not-eligible' });
  assert.deepEqual(run({}), { live: false, indexable: false, reason: 'not-eligible' }, 'trialRunning defaults to false');
  assert.deepEqual(run({ trialRunning: true, accountActive: false }), { live: false, indexable: false, reason: 'account-restricted' });
  for (const status of ['draft', 'pending', 'suspended', 'rejected']) assert.equal(run({ trialRunning: true, status }).live, false, `${status} is never live`);
  assert.deepEqual(run({ eligible: true }), { live: true, indexable: true, reason: 'live' });
  assert.deepEqual(run({ eligible: true, trialRunning: true }), { live: true, indexable: true, reason: 'live' }, 'eligible: standard rule');
});

// ---------------------------------------------------------------------------------------------
// The minisite route: (approved && eligible) || (approved && fastTrack && now < trialEndsAt)
// ---------------------------------------------------------------------------------------------

const baseRecord = (over = {}) => ({
  ownerUid: 'hh1', status: 'approved', displayName: 'Acme HR', handle: 'acme-hr', kind: 'agency', contact: { email: 'jobs@acme.example' },
  counters: { published: 9 }, version: 2, ...over,
});
function decide(recordOver, now, { open = 3 } = {}) {
  const record = baseRecord(recordOver);
  return minisite.resolveMinisite('acme-hr', undefined, {
    enabled: async () => true,
    lookup: async () => ({ kind: 'active', record }),
    accountActive: async () => true,
    projects: async () => ({ openCount: open, publishedCount: record.counters.published, items: [], closed: [] }),
    now: () => now,
  });
}
const fast = (over = {}) => ({ fastTrack: true, approvedAt: T0, trialEndsAt: T0 + HOURS * HOUR, ...over });

test('route: fast-track, 9 projects, inside the window: served, noindex', async () => {
  const result = await decide(fast(), T0 + 39 * HOUR);
  assert.equal(result.kind, 'page');
  assert.deepEqual(plain(result.state), { live: true, indexable: false, reason: 'trial' });
  const meta = minisite.minisiteMetadata(result);
  assert.equal(meta.robots?.index, false, 'noindex during the trial');
  assert.equal((await decide(fast(), T0 + 39 * HOUR, { open: 0 })).kind, 'page', 'live even with no open project');
});

test('route: fast-track, 9 projects, at and after 40 hours: 404, record untouched', async () => {
  assert.equal((await decide(fast(), T0 + HOURS * HOUR - 1)).kind, 'page', '1 ms before');
  assert.deepEqual(plain(await decide(fast(), T0 + HOURS * HOUR)), { kind: 'not-found' });
  assert.deepEqual(plain(await decide(fast(), T0 + 500 * HOUR)), { kind: 'not-found' });
});

test('route: fast-track that reached 10 (eligibleAt) is the standard rule: live and indexable, before and after 40 hours', async () => {
  for (const now of [T0 + HOUR, T0 + HOURS * HOUR + 1, T0 + 900 * HOUR]) {
    const result = await decide(fast({ eligibleAt: T0 + 5 * HOUR, counters: { published: 10 } }), now);
    assert.equal(result.kind, 'page');
    assert.deepEqual(plain(result.state), { live: true, indexable: true, reason: 'live' }, `at +${(now - T0) / HOUR}h`);
    assert.equal(minisite.minisiteMetadata(result).robots?.index, true);
  }
});

test('route: an expired fast-track page comes back by itself when the count reaches 10', async () => {
  const late = T0 + 100 * HOUR;
  assert.equal((await decide(fast(), late)).kind, 'not-found');
  assert.equal((await decide(fast({ eligibleAt: late - 1, counters: { published: 10 } }), late)).kind, 'page');
});

test('route: standard records are unchanged (9 projects is not live, 10 is), whatever the clock says', async () => {
  assert.equal((await decide({}, T0)).kind, 'not-found', 'approved, below the threshold');
  assert.equal((await decide({ eligibleAt: 1, counters: { published: 10 } }, T0 + 900 * HOUR)).kind, 'page');
  // A trialEndsAt on a record that is not fast-track (hand-edited data) opens nothing.
  assert.equal((await decide({ trialEndsAt: T0 + HOURS * HOUR }, T0)).kind, 'not-found');
  assert.equal((await decide({ fastTrack: false, trialEndsAt: T0 + HOURS * HOUR }, T0)).kind, 'not-found');
  for (const status of ['pending', 'draft', 'suspended', 'rejected']) assert.equal((await decide(fast({ status }), T0)).kind, 'not-found', `fast-track ${status}`);
});

test('route: without an injected clock the real one is used', async () => {
  const record = baseRecord(fast({ trialEndsAt: Date.now() + HOUR }));
  const deps = { enabled: async () => true, lookup: async () => ({ kind: 'active', record }), accountActive: async () => true, projects: async () => ({ openCount: 1, publishedCount: 9, items: [], closed: [] }) };
  assert.equal((await minisite.resolveMinisite('acme-hr', undefined, deps)).kind, 'page');
  record.trialEndsAt = Date.now() - HOUR;
  assert.equal((await minisite.resolveMinisite('acme-hr', undefined, deps)).kind, 'not-found');
});

// ---------------------------------------------------------------------------------------------
// The owner's view
// ---------------------------------------------------------------------------------------------

test('ownerView: the trial block for the editor, and no public URL once expired', () => {
  const ctx = (now) => ({ accountActive: true, now });
  const running = view.ownerView(baseRecord(fast()), ctx(T0 + 15 * HOUR + 1));
  assert.deepEqual(plain(running.trial), { fastTrack: true, phase: 'running', hours: 40, endsAt: T0 + HOURS * HOUR, hoursLeft: 25 });
  assert.equal(running.live, true);
  assert.match(running.publicUrl, /\/acme-hr$/);
  assert.deepEqual([running.progress.published, running.progress.required], [9, 10]);

  const expired = view.ownerView(baseRecord(fast()), ctx(T0 + HOURS * HOUR));
  assert.deepEqual(plain(expired.trial), { fastTrack: true, phase: 'expired', hours: 40, endsAt: T0 + HOURS * HOUR, hoursLeft: 0 });
  assert.equal(expired.live, false);
  assert.equal(expired.publicUrl, null);

  const waiting = view.ownerView(baseRecord({ status: 'pending', fastTrack: true }), ctx(T0));
  assert.equal(waiting.trial.phase, 'waiting');
  assert.equal(waiting.trial.endsAt, null);

  const met = view.ownerView(baseRecord(fast({ eligibleAt: 1, counters: { published: 10 } })), ctx(T0 + 999 * HOUR));
  assert.equal(met.trial.phase, 'met');
  assert.equal(met.live, true);

  const standard = view.ownerView(baseRecord({ status: 'draft' }), ctx(T0));
  assert.deepEqual(plain(standard.trial), { fastTrack: false, phase: 'none', hours: 40, endsAt: null, hoursLeft: 0 });
});

// ---------------------------------------------------------------------------------------------
// Validation: the option is accepted on apply only
// ---------------------------------------------------------------------------------------------

const validation = loadModule('src/lib/headhunters/validation.ts', { env });
const body = (extra = {}) => ({ displayName: 'Acme גיוס', kind: 'agency', contact: { email: 'hello@acme.example' }, ...extra });

test('validateHeadhunterInput: fastTrack is a boolean, allowed on apply only, stored only when true', () => {
  const apply = { allowFastTrack: true, requireAttestation: true };
  assert.equal(validation.validateHeadhunterInput(body({ fastTrack: true, attested: true }), apply).value.fastTrack, true);
  assert.equal('fastTrack' in validation.validateHeadhunterInput(body({ fastTrack: false, attested: true }), apply).value, false);
  assert.equal('fastTrack' in validation.validateHeadhunterInput(body({ attested: true }), apply).value, false);
  for (const bad of ['true', 1, null, {}]) assert.equal(validation.validateHeadhunterInput(body({ fastTrack: bad, attested: true }), apply).code, 'FAST_TRACK_INVALID', String(bad));
  assert.equal(validation.validateHeadhunterInput(body({ fastTrack: true })).code, 'UNKNOWN_FIELD', 'an edit cannot switch the track');
  assert.equal(validation.validateHeadhunterInput(body({ fastTrack: true }), { requireAttestation: false }).ok, false);
});

// ---------------------------------------------------------------------------------------------
// Apply, approval, counter, tag (over the in-memory Firestore)
// ---------------------------------------------------------------------------------------------

const owner = { uid: 'owner-1', name: 'Owner', email: 'owner@example.test' };
const LONG = 'תיאור מפורט של הפרויקט הנדרש ';
const project = (index) => ({ title: `Project number ${index}`, description: `${LONG}${index} `.repeat(4), ownerUid: owner.uid, status: 'open' });
const projects = (count) => Object.fromEntries(Array.from({ length: count }, (_, index) => [`p-${index}`, project(index)]));
const form = (extra = {}) => ({ displayName: 'Acme Recruiting', kind: 'agency', contact: { email: 'jobs@acme.example' }, attested: true, handle: 'acme-hr', ...extra });
const call = (route, method, path, payload) => route[method](new Request(`${SITE}${path}`, { method, ...(payload === undefined ? {} : { body: JSON.stringify(payload) }) }));

function world({ seed = {}, moderator = null, now = T0 } = {}) {
  const db = createFakeFirestore({ config: { headhunters: { enabled: true, applicationsOpen: true } }, ...seed });
  const ctx = { moderator, revalidated: [], announced: [], mails: [], now };
  let slug = 0;
  const stubs = {
    'next/server': { NextResponse, after: (task) => task() },
    'next/cache': { unstable_cache: (fn) => fn, revalidateTag: (tag) => ctx.revalidated.push(tag) },
    'node:crypto': { createHash, randomUUID: () => `slug-${++slug}` },
    'firebase-admin/firestore': { FieldValue: { serverTimestamp: () => 'SERVER_TS', delete: () => DELETE_FIELD }, FieldPath: {} },
    '@/lib/auth/session': { getCurrentUser: async () => owner, isSameOrigin: () => true },
    '@/lib/db/firestore': { firestore: () => db },
    '@/lib/security/rate-limit': { enforceActionLimit: async () => null },
    '@/lib/security/marketplace-policy': {
      accountWriteDenied: async () => null,
      accountState: (value) => (value === undefined || value === 'active' ? 'active' : 'restricted'),
    },
    '@/lib/security/moderator': { moderatorUid: async () => ctx.moderator },
    '@/lib/seo/indexnow': { submitIndexNow: async (urls) => { ctx.announced.push(...urls); } },
    '@/lib/projects/events': { onProjectPublished: (...args) => { ctx.announced.push(['project', args[2]?.minisiteHandle ?? null]); }, onProjectClosed: () => {} },
    '@/lib/db/projects': { listFeedProjects: async () => [], toPublicProject: (id, data) => ({ slug: id, title: data.title }) },
    '../notifications/headhunter-mail.ts': { sendHeadhunterDecisionMail: async (uid, input) => { ctx.mails.push(input); } },
  };
  const load = (file) => loadModule(file, { stubs, env: { ...env, XPLACE_IMPORT_ENABLED: 'true' } });
  return { db, ctx, routes: {
    headhunter: () => load('src/app/api/headhunter/route.ts'),
    moderation: () => load('src/app/api/moderation/headhunters/route.ts'),
    data: () => load('src/lib/db/headhunters.ts'),
    store: () => load('src/lib/headhunters/store.ts'),
  } };
}
const stored = (w) => w.db.docs('headhunters')[owner.uid];

test('apply with the live-now option: straight to review below the threshold, flag stored; the default stays a draft', async () => {
  const fastWorld = world({ seed: { projects: projects(2) } });
  const response = await call(fastWorld.routes.headhunter(), 'POST', '/api/headhunter', form({ fastTrack: true }));
  assert.equal(response.status, 201);
  assert.equal((await response.json()).status, 'pending');
  assert.equal(stored(fastWorld).status, 'pending');
  assert.equal(stored(fastWorld).fastTrack, true);
  assert.equal(stored(fastWorld).eligibleAt, undefined);
  assert.equal(stored(fastWorld).trialEndsAt, undefined, 'the clock starts at approval, not at apply');

  for (const extra of [{}, { fastTrack: false }]) {
    const standard = world({ seed: { projects: projects(2) } });
    assert.equal((await call(standard.routes.headhunter(), 'POST', '/api/headhunter', form(extra))).status, 201);
    assert.equal(stored(standard).status, 'draft');
    assert.equal('fastTrack' in stored(standard), false);
  }
  const bad = world();
  const refused = await call(bad.routes.headhunter(), 'POST', '/api/headhunter', form({ fastTrack: 'yes' }));
  assert.equal(refused.status, 400);
  assert.equal(bad.db.writes.length, 0);
});

test('an edit cannot switch a record to fast-track', async () => {
  const w = world({ seed: { headhunters: { [owner.uid]: { ownerUid: owner.uid, status: 'draft', displayName: 'Acme Recruiting', handle: 'acme-hr', kind: 'agency', contact: { email: 'jobs@acme.example' }, counters: { published: 1 }, version: 1 } } } });
  const response = await call(w.routes.headhunter(), 'PATCH', '/api/headhunter', { fastTrack: true });
  assert.equal(response.status, 400);
  assert.equal(w.db.docs('headhunters')[owner.uid].fastTrack, undefined);
});

const pendingFast = (extra = {}) => ({
  headhunters: { [owner.uid]: { ownerUid: owner.uid, status: 'pending', fastTrack: true, displayName: 'Acme Recruiting', handle: 'acme-hr', kind: 'agency', contact: { email: 'jobs@acme.example' }, counters: { published: 3 }, version: 1, ...extra } },
  handles: { 'acme-hr': { handle: 'acme-hr', ownerUid: owner.uid, state: 'active', skeleton: 'acmehr' } },
  projects: projects(3),
});
const moderate = (w, payload) => call(w.routes.moderation(), 'POST', '/api/moderation/headhunters', payload);

test('approving a fast-track record below the threshold: allowed, trialEndsAt = approval + 40h, no IndexNow, mail mentions the window', async () => {
  const w = world({ seed: pendingFast(), moderator: 'moderator-1' });
  const before = Date.now();
  const response = await moderate(w, { uid: owner.uid, action: 'approve' });
  const after = Date.now();
  assert.equal(response.status, 200);
  const json = await response.json();
  assert.equal(json.status, 'approved');
  assert.equal(json.fastTrack, true);
  const ends = stored(w).trialEndsAt.getTime();
  assert.ok(ends >= before + HOURS * HOUR && ends <= after + HOURS * HOUR, 'trialEndsAt is approval + 40 hours');
  assert.equal(json.trialEndsAt, ends);
  assert.equal(stored(w).eligibleAt, undefined, 'still not eligible: the standard rule has not been met');
  assert.equal(stored(w).approvedAt, 'SERVER_TS');
  assert.deepEqual(w.ctx.announced.filter((url) => typeof url === 'string'), [], 'a noindex trial page is not announced to IndexNow');
  assert.equal(w.ctx.mails[0].trial, true);
  assert.equal(w.ctx.mails[0].action, 'approve');
});

test('approving a standard record below the threshold is still refused; at 10 it is approved with no trial', async () => {
  const standard = world({ seed: pendingFast({ fastTrack: undefined }), moderator: 'moderator-1' });
  const refused = await moderate(standard, { uid: owner.uid, action: 'approve' });
  assert.equal(refused.status, 409);
  assert.equal((await refused.json()).error, 'NOT_ELIGIBLE');

  const ten = world({ seed: { ...pendingFast({ fastTrack: undefined, counters: { published: 10 }, eligibleAt: 1 }), projects: projects(10) }, moderator: 'moderator-1' });
  assert.equal((await moderate(ten, { uid: owner.uid, action: 'approve' })).status, 200);
  assert.equal(stored(ten).trialEndsAt, undefined);
  assert.equal(ten.ctx.announced.some((url) => typeof url === 'string'), true, 'a standard page is announced as before');
  assert.equal(ten.ctx.mails[0].trial, undefined);
});

test('a re-approval never extends the window', async () => {
  const first = T0 + HOURS * HOUR;
  const w = world({ seed: pendingFast({ trialEndsAt: new Date(first), approvedAt: 1 }), moderator: 'moderator-1' });
  assert.equal((await moderate(w, { uid: owner.uid, action: 'approve' })).status, 200);
  assert.equal(stored(w).trialEndsAt.getTime(), first);
});

test('a fast-track record at 10 published projects at approval is eligible: the standard rule, still gets the window recorded', async () => {
  const w = world({ seed: { ...pendingFast({ counters: { published: 10 } }), projects: projects(10) }, moderator: 'moderator-1' });
  const response = await moderate(w, { uid: owner.uid, action: 'approve' });
  assert.equal(response.status, 200);
  assert.equal(stored(w).eligibleAt, 'SERVER_TS');
  assert.equal(w.ctx.announced.some((url) => typeof url === 'string'), true, 'eligible: indexable, so announced');
  assert.equal(w.ctx.mails[0].trial, undefined, 'no trial wording when the threshold is already met');
});

test('the 10th project during the trial sets eligibleAt (sticky) and keeps it approved; the 9th does not', async () => {
  const w = world({ seed: pendingFast({ status: 'approved', approvedAt: 1, trialEndsAt: new Date(T0 + HOURS * HOUR), counters: { published: 8 } }) });
  const data = w.routes.data();
  const create = (index) => w.db.runTransaction(async (tx) => data.applyProjectCreated(tx, await data.readHeadhunterForCounter(tx, owner.uid), project(index)));
  const ninth = await create(100);
  assert.deepEqual({ ...ninth }, { handle: 'acme-hr', statusChanged: false, becameEligible: false, status: 'approved' });
  assert.equal(stored(w).eligibleAt, undefined);
  const tenth = await create(101);
  assert.deepEqual({ ...tenth }, { handle: 'acme-hr', statusChanged: false, becameEligible: true, status: 'approved' });
  assert.equal(stored(w).eligibleAt, 'SERVER_TS');
  assert.equal(stored(w).counters.published, 10);
  // The pure rule behind it: sticky after a later drop to 9.
  assert.equal(counter.planCounter({ status: 'approved', published: 10, hasEligibleAt: true }, 9).setEligibleAt, false);
});

test('minisiteAfterCounter: a trial page that just reached the threshold is announced; one that did not is not', () => {
  const pings = loadModule('src/lib/headhunters/pings.ts', { env });
  assert.equal(pings.minisiteAfterCounter(null, { handle: 'acme-hr', becameEligible: true, status: 'approved' }), 'acme-hr');
  assert.equal(pings.minisiteAfterCounter(null, { handle: 'acme-hr', becameEligible: false, status: 'approved' }), null);
  assert.equal(pings.minisiteAfterCounter(null, { handle: 'acme-hr', becameEligible: true, status: 'pending' }), null);
  assert.equal(pings.minisiteAfterCounter(null, null), null);
  assert.equal(pings.minisiteAfterCounter('other-hr', null), 'other-hr');
});

test('getPublicHeadhunters (the project tag): a trial shows the tag inside the window only; standard rule unchanged', async () => {
  const rec = (uid, extra = {}) => ({ ownerUid: uid, status: 'approved', displayName: `Name ${uid}`, handle: `agency-${uid}`, kind: 'agency', contact: { email: 'a@b.example' }, counters: { published: 9 }, ...extra });
  const w = world({ seed: { headhunters: {
    running: rec('running', { fastTrack: true, trialEndsAt: new Date(Date.now() + HOUR) }),
    expired: rec('expired', { fastTrack: true, trialEndsAt: new Date(Date.now() - HOUR) }),
    noEnd: rec('noend', { fastTrack: true }),
    met: rec('met', { fastTrack: true, trialEndsAt: new Date(Date.now() - HOUR), eligibleAt: 1 }),
    standard: rec('standard'),
    standardWithEnd: rec('standardend', { trialEndsAt: new Date(Date.now() + HOUR) }),
    pendingFast: rec('pendingfast', { status: 'pending', fastTrack: true, trialEndsAt: new Date(Date.now() + HOUR) }),
  } } });
  const found = await w.routes.data().getPublicHeadhunters(['running', 'expired', 'noEnd', 'met', 'standard', 'standardWithEnd', 'pendingFast']);
  assert.deepEqual([...found.keys()].sort(), ['met', 'running']);
});

// ---------------------------------------------------------------------------------------------
// Sitemap / llms: a trial page is never listed
// ---------------------------------------------------------------------------------------------

test('indexableHeadhunterEntries and the state predicate: a trial row (not eligible) is never listed', () => {
  const seo = loadModule('src/lib/headhunters/seo.ts', { env });
  const row = (over = {}) => ({ handle: 'acme-hr', displayName: 'Acme', status: 'approved', eligible: true, accountActive: true, openProjects: 4, ...over });
  assert.equal(seo.indexableHeadhunterEntries([row()]).length, 1);
  assert.equal(seo.indexableHeadhunterEntries([row({ eligible: false })]).length, 0, 'trial or expired: out of the sitemap and llms-full');
});

// ---------------------------------------------------------------------------------------------
// Copy and the editor
// ---------------------------------------------------------------------------------------------

const copy = loadModule('src/lib/headhunters/editor-copy.ts', { env });

test('copy: the sign-up notice and the track options state the 40 hours and the 10 projects from the constants', () => {
  assert.match(copy.TRIAL_NOTICE.text, /אם לא יפורסמו 10 פרויקטים תוך 40 שעות/);
  assert.match(copy.TRIAL_NOTICE.text, /העמוד יוסר/);
  assert.match(copy.TRIAL_NOTICE.text, /הפרויקטים עצמם נשארים/);
  assert.match(copy.TRACK_COPY.standard.text, /10 פרויקטים/);
  assert.match(copy.TRACK_COPY.fast.text, /ברגע האישור/);
  assert.match(copy.TRACK_COPY.fast.text, /40 שעות/);
  assert.equal(copy.TRIAL_STATUS.runningLeft(25), 'נותרו 25 שעות');
  assert.equal(copy.TRIAL_STATUS.runningLeft(2), 'נותרו שעתיים');
  assert.equal(copy.TRIAL_STATUS.runningLeft(1), 'נותרו פחות משעה');
});

const NOT_FOUND = { digest: 'NEXT_NOT_FOUND' };
function editorHtml({ rec = null, applicationsOpen = true, now = T0 } = {}) {
  const page = loadModule('src/app/profile/headhunter/page.tsx', { env, stubs: {
    'next/navigation': { notFound() { throw Object.assign(new Error('NEXT_NOT_FOUND'), NOT_FOUND); }, redirect() { throw new Error('redirect'); }, useRouter: () => ({ refresh() {} }) },
    'next/link': { __esModule: true, default: ({ href, children, prefetch, ...rest }) => createElement('a', { href, ...rest }, children) },
    'next/image': { __esModule: true, default: ({ src, alt }) => createElement('img', { src, alt }) },
    '@/components/support-chat': { SupportHeaderActions: ({ children }) => createElement('div', null, children) },
    '@/lib/auth/session': { getCurrentUser: async () => ({ uid: 'owner-1', email: 'a@b.example' }) },
    '@/lib/headhunters/view': { ownerView: (record, context) => view.ownerView(record, { ...context, now }) },
    '@/lib/db/headhunters': { getHeadhunterConfig: async () => ({ enabled: true, applicationsOpen }), getHeadhunter: async () => rec, isAccountActive: async () => true },
  } });
  return page.default().then((element) => renderToStaticMarkup(element));
}

test('editor, apply form: both tracks as radios (standard preselected) and the notice is the last thing on the page', async () => {
  const out = await editorHtml();
  assert.equal((out.match(/type="radio"/g) ?? []).length, 2);
  assert.match(out, /עמוד פעיל מיד/);
  assert.match(out, /מסלול רגיל/);
  const standard = out.match(/<input type="radio" name="hh-track"[^>]*>/g);
  assert.match(standard[0], /checked/);
  assert.doesNotMatch(standard[1], /checked/);
  assert.ok(out.lastIndexOf('אם לא יפורסמו 10 פרויקטים תוך 40 שעות') > out.lastIndexOf('שליחת הבקשה'), 'the notice comes after the submit button');
  assert.match(out.trimEnd(), /<p class="hh-ed-trial-notice"[^>]*>[\s\S]*<\/p><\/div><\/main>$/, 'nothing follows the notice inside the page');
});

const approvedFast = (extra = {}) => ({
  ownerUid: 'owner-1', status: 'approved', fastTrack: true, displayName: 'אופק גיוס', handle: 'ofek-hr', kind: 'agency', contact: { email: 'hello@ofek-hr.example' },
  counters: { published: 7 }, approvedAt: T0, trialEndsAt: T0 + HOURS * HOUR, version: 3, ...extra,
});

test('editor during the trial: pill, hours left, X of 10, the removal warning and the live link', async () => {
  const out = await editorHtml({ rec: approvedFast(), now: T0 + 15 * HOUR + 1 });
  assert.match(out, /פעיל · תקופת ניסיון/);
  assert.match(out, /נותרו 25 שעות/);
  assert.match(out, /7 מתוך 10 פרויקטים/);
  assert.match(out, /העמוד יוסר/);
  assert.match(out, /\/ofek-hr/);
  assert.doesNotMatch(out, /type="radio"/, 'no track choice after applying');
  assert.doesNotMatch(out, /hh-ed-trial-notice/, 'the sign-up notice is for the sign-up page');
});

test('editor after the window: the page is reported as removed, no live link, and how it returns', async () => {
  const out = await editorHtml({ rec: approvedFast(), now: T0 + HOURS * HOUR + 1 });
  assert.match(out, /תקופת הניסיון הסתיימה, העמוד הוסר/);
  assert.match(out, /לא מוצג כרגע/);
  assert.match(out, /יחזור לאוויר מעצמו/);
  assert.doesNotMatch(out, /לצפייה בעמוד/);
  assert.doesNotMatch(out, /העמוד פעיל</);
});

test('editor, a fast-track application waiting for approval says what happens on approval', async () => {
  const out = await editorHtml({ rec: approvedFast({ status: 'pending', trialEndsAt: undefined, approvedAt: undefined }) });
  assert.match(out, /אחרי האישור העמוד עולה לאוויר מיד/);
  assert.match(out, /40 שעות/);
});

test('editor, a standard record shows no trial text', async () => {
  const out = await editorHtml({ rec: { ...approvedFast(), fastTrack: undefined, trialEndsAt: undefined, eligibleAt: 1, counters: { published: 12 } }, now: T0 });
  assert.doesNotMatch(out, /תקופת ניסיון/);
  assert.doesNotMatch(out, /נותרו/);
  assert.match(out, /העמוד פעיל/);
});

test('request body: the track is sent on apply only, and only when chosen', () => {
  const editor = loadModule('src/lib/headhunters/editor.ts', { env });
  const values = { ...editor.EMPTY_FORM, displayName: 'Acme', handle: 'acme-hr', email: 'a@b.example', attested: true };
  assert.equal('fastTrack' in editor.requestBody(values, { apply: true }), false);
  assert.equal(editor.requestBody({ ...values, fastTrack: true }, { apply: true }).fastTrack, true);
  assert.equal('fastTrack' in editor.requestBody({ ...values, fastTrack: true }, { apply: false }), false, 'an edit never sends it');
  assert.equal(editor.formKeyForField('fastTrack'), 'fastTrack');
});

// ---------------------------------------------------------------------------------------------
// Moderation queue and mail
// ---------------------------------------------------------------------------------------------

test('moderation queue lists fastTrack and trialEndsAt', async () => {
  const w = world({ seed: pendingFast(), moderator: 'moderator-1' });
  const response = await call(w.routes.moderation(), 'GET', '/api/moderation/headhunters?status=pending');
  const { items } = await response.json();
  assert.equal(items[0].fastTrack, true);
  assert.equal(items[0].trialEndsAt, null);
});

test('decision mail: the approval of a trial page carries the 40-hour line, nothing else changes', () => {
  const mail = loadModule('src/lib/headhunters/mail.ts', { env });
  const plainMail = mail.buildDecisionMail({ action: 'approve', handle: 'acme-hr', displayName: 'Acme' });
  const trialMail = mail.buildDecisionMail({ action: 'approve', handle: 'acme-hr', displayName: 'Acme', trial: true });
  assert.doesNotMatch(plainMail.text, /40 שעות/);
  assert.match(trialMail.text, /40 שעות/);
  assert.match(trialMail.text, /יוסר/);
  assert.ok(trialMail.text.includes(`${SITE}/acme-hr`));
});
