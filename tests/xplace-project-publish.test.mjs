import test from 'node:test';
import assert from 'node:assert/strict';
import { NextResponse } from 'next/server.js';
import { loadModule } from './helpers/load-ts.mjs';
import { createFakeFirestore } from './helpers/fake-firestore.mjs';

const errorsModule = loadModule('src/lib/imports/errors.ts');
const validation = loadModule('src/lib/projects/validation.ts');
const user = { uid: 'owner-1', name: 'Account Name', email: 'person@example.com' };
const PROJECT_URL = 'https://www.xplace.com/il/job-bids/123456';
const KEY = 'xplace:project:123456';
const base = { title: 'Build a landing page', category: 'כללי', description: 'A complete description of the work to be done.', budget: '₪5,000', deadline: 'גמיש', skills: ['React'] };
const provenance = (extra = {}) => ({ provider: 'xplace', url: 'xplace.com/project?id=123456', attested: true, publisherNameOnSource: 'Acme Studio', ...extra });

function setup({ seed = {}, enabled = true, limit = null } = {}) {
  const db = createFakeFirestore(seed);
  const published = [];
  const calls = [];
  let counter = 0;
  const route = loadModule('src/app/api/marketplace/projects/route.ts', {
    env: { XPLACE_IMPORT_ENABLED: enabled ? 'true' : 'false' },
    stubs: {
      'next/server': { NextResponse },
      'node:crypto': { randomUUID: () => `slug-${++counter}` },
      'firebase-admin/firestore': { FieldValue: { serverTimestamp: () => 'SERVER_TS' }, FieldPath: {} },
      'next/cache': { unstable_cache: (fn) => fn },
      '@/lib/auth/session': { getCurrentUser: async () => user, isSameOrigin: () => true },
      '@/lib/db/firestore': { firestore: () => db },
      '@/lib/security/rate-limit': { enforceActionLimit: async (...args) => { calls.push(['limit', ...args]); return limit; } },
      '@/lib/security/marketplace-policy': { accountWriteDenied: async (...args) => { calls.push(['denied', ...args]); return null; }, assertContactAllowed: async () => {}, ContactUnavailable: class extends Error {} },
      '@/lib/imports/errors': errorsModule,
      '@/lib/projects/events': { onProjectPublished: (slug, record) => published.push([slug, record]), onProjectClosed: () => {} },
      '@/lib/db/projects': { listFeedProjects: async () => [], toPublicProject: (slug, record) => ({ slug, title: record.title, client: record.clientName }) },
    },
  });
  return { route, db, published, calls };
}
const publish = (route, body) => route.POST(new Request('https://example.test/api/marketplace/projects', { method: 'POST', body: JSON.stringify(body) }));
const imported = (db) => Object.entries(db.docs('projects'));

test('without `import` the existing path is unchanged (no transaction, no importSource, same clientName rule)', async () => {
  const { route, db, published, calls } = setup();
  db.runTransaction = async () => { throw new Error('the plain path must not use a transaction'); };
  const response = await publish(route, base);
  assert.equal(response.status, 201);
  const [[id, record]] = imported(db);
  assert.equal(id, 'slug-1');
  assert.deepEqual(Object.keys(record).sort(), ['budget', 'category', 'clientName', 'createdAt', 'deadline', 'description', 'ownerUid', 'proposals', 'skills', 'status', 'title', 'updatedAt'].sort());
  assert.equal(record.clientName, 'Account Name');
  assert.equal(published.length, 1);
  assert.deepEqual(calls.map((call) => call[0]), ['limit', 'denied']);
  assert.deepEqual(calls[0], ['limit', user.uid, 'project.create']);
});

test('import with the flag off is IMPORT_DISABLED and writes nothing', async () => {
  const { route, db, published } = setup({ enabled: false });
  const response = await publish(route, { ...base, import: provenance() });
  assert.equal(response.status, 503);
  assert.equal((await response.json()).code, 'IMPORT_DISABLED');
  assert.equal(db.writes.length + published.length, 0);
});

test('invalid provenance is rejected strictly', async () => {
  const bad = [null, 'x', [], {}, provenance({ extra: 1 }), provenance({ provider: 'other' }), provenance({ url: 'https://example.com/il/job-bids/123456' }),
    provenance({ url: 'https://www.xplace.com/il/u/someone' }), provenance({ publisherNameOnSource: 5 }), provenance({ createPublisherName: 'x'.repeat(201) }), provenance({ publisherMismatchConfirmed: 'yes' })];
  for (const value of bad) {
    const { route, db, published } = setup();
    const response = await publish(route, { ...base, import: value });
    assert.equal(response.status, 400, JSON.stringify(value));
    assert.notEqual((await response.json()).code, 'ALREADY_IMPORTED');
    assert.equal(db.writes.length + published.length, 0);
  }
});

test('attestation is required', async () => {
  for (const attested of [undefined, false, 'true']) {
    const { route, db } = setup();
    const response = await publish(route, { ...base, import: provenance({ attested }) });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).code, 'ATTESTATION_REQUIRED');
    assert.equal(db.writes.length, 0);
  }
});

test('validateImportProvenance normalises and returns the canonical target', () => {
  const result = validation.validateImportProvenance(provenance({ publisherNameOnSource: '  Acme  ', createPublisherName: ' New ', publisherMismatchConfirmed: true }));
  assert.equal(result.ok, true);
  assert.deepEqual({ ...result.value.provenance }, { provider: 'xplace', url: PROJECT_URL, attested: true, captured: 'link', ownerSignal: null, publisherNameOnSource: 'Acme', createPublisherName: 'New', publisherMismatchConfirmed: true });
  assert.equal(result.value.target.projectId, '123456');
  assert.equal(validation.validateImportProvenance({ provider: 'xplace', url: PROJECT_URL, attested: true }).ok, true);
});

test('re-importing the same project is ALREADY_IMPORTED with the existing slug, per owner', async () => {
  const seed = { projects: { existing: { ownerUid: user.uid, importSource: { key: KEY } }, other: { ownerUid: 'someone-else', importSource: { key: 'xplace:project:999999' } } }, profiles: { [user.uid]: { name: 'Acme Studio' } } };
  const { route, db, published } = setup({ seed });
  const response = await publish(route, { ...base, import: provenance() });
  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), { code: 'ALREADY_IMPORTED', error: 'הפרויקט הזה כבר יובא לחשבון שלך.', slug: 'existing' });
  assert.equal(db.writes.length + published.length, 0);
  // Another owner's import of the same XPlace project does not block this user.
  const { route: route2, db: db2 } = setup({ seed: { projects: { theirs: { ownerUid: 'someone-else', importSource: { key: KEY } } }, profiles: { [user.uid]: { name: 'Acme Studio' } } } });
  assert.equal((await publish(route2, { ...base, import: provenance() })).status, 201);
  assert.equal(Object.keys(db2.docs('projects')).length, 2);
});

test('a publisher mismatch needs explicit confirmation', async () => {
  const seed = { profiles: { [user.uid]: { name: 'Other Company' } } };
  const { route, db, published } = setup({ seed });
  const refused = await publish(route, { ...base, import: provenance({ publisherMismatchConfirmed: false }) });
  assert.equal(refused.status, 409);
  const body = await refused.json();
  assert.equal(body.code, 'PUBLISHER_MISMATCH_UNCONFIRMED');
  assert.equal(db.writes.length + published.length, 0);
  const confirmed = await publish(route, { ...base, import: provenance({ publisherMismatchConfirmed: true }) });
  assert.equal(confirmed.status, 201);
  const [[, record]] = imported(db);
  assert.equal(record.importSource.publisherMatch, 'mismatch-confirmed');
  assert.equal(record.clientName, 'Other Company');
});

test('no publisher profile needs createPublisherName, and nothing is written when it is missing', async () => {
  for (const missing of [undefined, '', '   ']) {
    const { route, db, published } = setup();
    const response = await publish(route, { ...base, import: provenance(missing === undefined ? {} : { createPublisherName: missing }) });
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { code: 'PUBLISHER_NAME_REQUIRED', error: 'נדרש שם מפרסם כדי להשלים את הייבוא.' });
    assert.equal(db.writes.length + published.length, 0);
  }
});

test('creating the publisher profile writes only name, ownerUid and updatedAt and never touches existing fields', async () => {
  const fresh = setup();
  assert.equal((await publish(fresh.route, { ...base, import: provenance({ createPublisherName: ' New Publisher ' }) })).status, 201);
  const profileWrites = fresh.db.writes.filter((write) => write.collection === 'profiles');
  assert.equal(profileWrites.length, 1);
  assert.equal(profileWrites[0].merge, true);
  assert.deepEqual({ ...profileWrites[0].data }, { name: 'New Publisher', ownerUid: user.uid, updatedAt: 'SERVER_TS' });
  const [[, created]] = imported(fresh.db);
  assert.equal(created.clientName, 'New Publisher');
  assert.equal(created.importSource.publisherMatch, 'created');

  const existing = setup({ seed: { profiles: { [user.uid]: { name: '', phone: '050', email: 'p@example.com', logo: 'logo.png' } } } });
  assert.equal((await publish(existing.route, { ...base, import: provenance({ createPublisherName: 'Fresh Name' }) })).status, 201);
  assert.deepEqual({ ...existing.db.docs('profiles')[user.uid] }, { name: 'Fresh Name', phone: '050', email: 'p@example.com', logo: 'logo.png', ownerUid: user.uid, updatedAt: 'SERVER_TS' });
});

test('an existing profile is never written to and wins over createPublisherName for clientName', async () => {
  const seed = { profiles: { [user.uid]: { name: 'Acme Studio', phone: '050' } } };
  const { route, db } = setup({ seed });
  assert.equal((await publish(route, { ...base, import: provenance({ createPublisherName: 'Ignored' }) })).status, 201);
  assert.equal(db.writes.filter((write) => write.collection === 'profiles').length, 0);
  assert.deepEqual({ ...db.docs('profiles')[user.uid] }, { name: 'Acme Studio', phone: '050' });
  const [[, record]] = imported(db);
  assert.equal(record.clientName, 'Acme Studio');
  assert.equal(record.importSource.publisherMatch, 'match');
});

test('unknown source publisher keeps the profile name and records `unknown`; clientName falls back to the account', async () => {
  const withProfile = setup({ seed: { profiles: { [user.uid]: { name: 'Acme Studio' } } } });
  assert.equal((await publish(withProfile.route, { ...base, import: provenance({ publisherNameOnSource: undefined }) })).status, 201);
  const [[, record]] = imported(withProfile.db);
  assert.equal(record.importSource.publisherMatch, 'unknown');
  assert.equal(record.importSource.publisherNameOnSource, '');
  assert.equal(record.clientName, 'Acme Studio');
});

test('importSource is stored, the public projection hides it, and the publish hook runs once', async () => {
  const { route, db, published } = setup({ seed: { profiles: { [user.uid]: { name: 'Acme Studio' } } } });
  const response = await publish(route, { ...base, import: provenance() });
  assert.equal(response.status, 201);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.project.slug, 'slug-1');
  assert.equal(JSON.stringify(body).includes('importSource'), false);
  const record = db.docs('projects')['slug-1'];
  assert.deepEqual({ ...record.importSource }, { provider: 'xplace', key: KEY, url: PROJECT_URL, externalId: '123456', publisherNameOnSource: 'Acme Studio', publisherMatch: 'match', captured: 'link', ownerSignal: null, importedAt: 'SERVER_TS' });
  assert.equal(record.ownerUid, user.uid);
  assert.equal(record.status, 'open');
  assert.equal(record.proposals, 0);
  assert.equal(published.length, 1);
  assert.equal(published[0][0], 'slug-1');
  assert.equal(published[0][1].importSource.key, KEY);
});

test('toPublicProject (real implementation) does not expose importSource', async () => {
  const projects = loadModule('src/lib/db/projects.ts', { stubs: { 'next/cache': { unstable_cache: (fn) => fn }, 'firebase-admin/firestore': { FieldPath: {} }, './firestore': { firestore() { throw new Error('no db'); } }, '@/lib/seo/publication': {} } });
  const publicProject = projects.toPublicProject('s', { ...base, clientName: 'Acme', importSource: { key: KEY, url: PROJECT_URL, publisherNameOnSource: 'Acme' } });
  assert.equal(JSON.stringify(publicProject).includes('importSource'), false);
  assert.equal(JSON.stringify(publicProject).includes('xplace'), false);
});

test('limit, account check and a failing transaction keep their order and the generic 503', async () => {
  const limited = Response.json({ code: 'RATE_LIMITED' }, { status: 429 });
  const stopped = setup({ limit: limited });
  assert.equal(await publish(stopped.route, { ...base, import: provenance() }), limited);
  assert.equal(stopped.db.writes.length, 0);
  const failing = setup({ seed: { profiles: { [user.uid]: { name: 'Acme Studio' } } } });
  failing.db.runTransaction = async () => { throw new Error('contention'); };
  const response = await publish(failing.route, { ...base, import: provenance() });
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error, 'לא הצלחנו לפרסם את הפרויקט.');
  assert.equal(failing.published.length, 0);
});

test('provenance accepts captured and ownerSignal, defaults them, and the publish route stores them', async () => {
  const ok = validation.validateImportProvenance(provenance({ captured: 'extension', ownerSignal: true }));
  assert.equal(ok.value.provenance.captured, 'extension');
  assert.equal(ok.value.provenance.ownerSignal, true);
  assert.equal(validation.validateImportProvenance(provenance({ ownerSignal: null })).value.provenance.ownerSignal, null);
  for (const bad of [{ captured: 'robot' }, { captured: 1 }, { ownerSignal: 'yes' }, { ownerSignal: 1 }]) assert.equal(validation.validateImportProvenance(provenance(bad)).ok, false, JSON.stringify(bad));
  const { route, db } = setup({ seed: { profiles: { [user.uid]: { name: 'Acme Studio' } } } });
  assert.equal((await publish(route, { ...base, import: provenance({ captured: 'extension', ownerSignal: false }) })).status, 201);
  const record = db.docs('projects')['slug-1'];
  assert.equal(record.importSource.captured, 'extension');
  assert.equal(record.importSource.ownerSignal, false);
});
