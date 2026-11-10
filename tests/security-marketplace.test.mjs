import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server.js';
import { loadModule } from './helpers/load-ts.mjs';

const user = { uid: 'viewer' };
const baseStubs = {
  'next/server': { NextResponse },
  'node:crypto': { createHash, randomUUID },
  'firebase-admin/firestore': { FieldValue: { serverTimestamp: () => 1 } },
  '@/lib/auth/session': { getCurrentUser: async () => user, isSameOrigin: () => true },
  '@/lib/db/firestore': { firestore() { throw new Error('Unexpected database access'); } },
  '@/lib/db/storage': {},
  '@/lib/db/projects': {},
  '@/lib/projects/events': {},
  '@/lib/ai': {},
  '@/lib/data': {},
  '@/lib/membership/access': { requireMarketplaceAccess: async () => null },
};

test('all six costly writes stop at the quota before reading the body or calling providers', async () => {
  for (const [route, action] of [
    ['marketplace/projects', 'project.create'], ['marketplace/proposals', 'proposal.create'],
    ['marketplace/conversations', 'message.send'], ['uploads/profile-source', 'source.upload'],
    ['ai/profile', 'ai.profile'], ['ai/project-brief', 'ai.projectBrief'],
  ]) {
    const checks = [];
    const limited = Response.json({ code: 'RATE_LIMITED' }, { status: 429 });
    const module = loadModule(`src/app/api/${route}/route.ts`, { stubs: { ...baseStubs,
      '@/lib/security/rate-limit': { enforceActionLimit: async (...args) => { checks.push(args); return limited; } },
    } });
    const request = new Request('https://example.test/api/test', { method: 'POST', body: '{unread' });
    assert.equal(await module.POST(request), limited, route);
    assert.deepEqual(checks, [[user.uid, action]], route);
    assert.equal(request.bodyUsed, false, route);
  }
});

test('conversation content and messages stay within the two participants for reads and writes', async () => {
  const id = 'a'.repeat(64);
  for (const participant of [true, false]) {
    const writes = [];
    let messageReads = 0;
    const data = { clientUid: 'client', freelancerUid: participant ? 'viewer' : 'other-user' };
    const snapshot = { exists: true, id, data: () => data };
    const ref = { get: async () => snapshot, collection: () => ({
      orderBy: () => ({ limit: () => ({ get: async () => { messageReads++; return { docs: [] }; } }) }),
      doc: () => ({}),
    }) };
    const db = { collection: () => ({ doc: () => ref }), runTransaction: work => work({
      get: async () => snapshot,
      create: (...args) => writes.push(args), update: (...args) => writes.push(args),
    }) };
    const route = loadModule('src/app/api/marketplace/conversations/route.ts', { stubs: { ...baseStubs,
      '@/lib/db/firestore': { firestore: () => db },
      '@/lib/security/rate-limit': { enforceActionLimit: async () => null },
    } });
    const read = await route.GET(new Request(`https://example.test/api/test?id=${id}`));
    assert.equal(read.status, participant ? 200 : 404);
    assert.equal(messageReads, participant ? 1 : 0);
    const write = await route.POST(new Request('https://example.test/api/test', { method: 'POST', body: JSON.stringify({ conversationId: id, text: 'message' }) }));
    assert.equal(write.status, participant ? 201 : 404);
    assert.equal(writes.length, participant ? 2 : 0);
  }
});
