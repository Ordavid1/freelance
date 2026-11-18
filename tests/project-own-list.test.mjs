import test from 'node:test';
import assert from 'node:assert/strict';
import { NextResponse } from 'next/server.js';
import { loadModule } from './helpers/load-ts.mjs';
import { createFakeFirestore } from './helpers/fake-firestore.mjs';

// `GET /api/marketplace/projects?mine=1` is the signed-in owner's own list ("הפרויקטים שלי"). An archived project is
// withdrawn from the product: no feed card and no page. It must therefore leave the owner's list too, instead of
// showing up there as a half-drawn card (an archived record has no badge and no details to draw).

const owner = { uid: 'owner-1', name: 'Owner', email: 'owner@example.test' };
const projects = {
  'p-open': { title: 'Open project', ownerUid: 'owner-1', status: 'open' },
  'p-closed': { title: 'Closed project', ownerUid: 'owner-1', status: 'closed' },
  'p-archived': { title: 'Archived project', ownerUid: 'owner-1', status: 'archived' },
  'p-legacy': { title: 'Legacy project without a status', ownerUid: 'owner-1' },
  'p-other': { title: 'Somebody else', ownerUid: 'owner-2', status: 'open' },
  'p-other-archived': { title: 'Somebody else, archived', ownerUid: 'owner-2', status: 'archived' },
};

function setup(user = owner) {
  const db = createFakeFirestore({ projects });
  const route = loadModule('src/app/api/marketplace/projects/route.ts', {
    stubs: {
      'next/server': { NextResponse },
      'node:crypto': { randomUUID: () => 'unused' },
      'firebase-admin/firestore': { FieldValue: { serverTimestamp: () => 'SERVER_TS' }, FieldPath: {} },
      'next/cache': { unstable_cache: (fn) => fn },
      '@/lib/auth/session': { getCurrentUser: async () => user, isSameOrigin: () => true },
      '@/lib/db/firestore': { firestore: () => db },
      '@/lib/security/rate-limit': { enforceActionLimit: async () => null },
      '@/lib/security/marketplace-policy': { accountWriteDenied: async () => null, assertContactAllowed: async () => {}, ContactUnavailable: class extends Error {} },
      '@/lib/imports/errors': loadModule('src/lib/imports/errors.ts'),
      '@/lib/projects/events': { onProjectPublished: () => {}, onProjectClosed: () => {} },
      '@/lib/db/projects': { listFeedProjects: async () => [], toPublicProject: (slug, record) => ({ slug, title: record.title, status: record.status || 'open' }) },
    },
  });
  return { route };
}
const mine = (route) => route.GET(new Request('https://example.test/api/marketplace/projects?mine=1'));

test('the owner list shows open, closed and status-less projects, and leaves out archived ones', async () => {
  const { route } = setup();
  const response = await mine(route);
  assert.equal(response.status, 200);
  const { items } = await response.json();
  assert.deepEqual(items.map((item) => item.slug).sort(), ['p-closed', 'p-legacy', 'p-open']);
  assert.ok(!items.some((item) => item.status === 'archived'));
});

test('only the signed-in owner’s own projects are listed', async () => {
  const { route } = setup({ uid: 'owner-2', name: 'Other', email: 'other@example.test' });
  const { items } = await (await mine(route)).json();
  assert.deepEqual(items.map((item) => item.slug), ['p-other'], 'the other owner sees their open project and not their archived one');
});

test('the owner list still requires a signed-in user', async () => {
  const { route } = setup(null);
  assert.equal((await mine(route)).status, 401);
});
