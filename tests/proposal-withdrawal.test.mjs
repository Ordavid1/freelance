import { loadModule } from './helpers/load-ts.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { NextResponse } from 'next/server.js';
function fixture({ uid = 'owner', status = 'submitted', sameOrigin = true, signedIn = true } = {}) {
  const writes = [];
  const stubs = {
    '@/lib/security/request-body': loadModule('src/lib/security/request-body.ts'),
    '@/lib/security/rate-limit': { enforceActionLimit: async () => null },
    '@/lib/auth/session': { getCurrentUser: async () => signedIn ? { uid: 'owner' } : null, isSameOrigin: () => sameOrigin },
    '@/lib/membership/access': { requireMarketplaceAccess: async () => null },
    'node:crypto': {}, 'firebase-admin/firestore': { FieldValue: { serverTimestamp: () => 'timestamp' } }, 'next/server': { NextResponse },
    '@/lib/db/firestore': { firestore: () => ({ collection: name => ({ doc: id => ({ name, id }) }), runTransaction: async fn => fn({
      get: async ref => ({ exists: true, get: key => ref.name === 'proposals' ? ({ freelancerUid: uid, status, projectSlug: 'project' })[key] : 1 }),
      update: (ref, value) => writes.push({ ref, value }),
    }) }) },
  };
  const module = { exports: {} };
  const code = ts.transpileModule(readFileSync('src/app/api/marketplace/proposals/route.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  vm.runInNewContext(code, { module, exports: module.exports, require: name => stubs[name], console });
  return { writes, run: () => module.exports.PATCH(new Request('http://localhost/api/marketplace/proposals', { method: 'PATCH', body: JSON.stringify({ proposalId: 'a'.repeat(64) }) })) };
}
test('withdrawal updates the proposal and active count once, preserving conversations', async () => {
  const f = fixture(); assert.equal((await f.run()).status, 200);
  assert.equal(f.writes.length, 2); assert.equal(f.writes[0].value.status, 'withdrawn'); assert.equal(f.writes[1].value.proposals, 0);
  const repeat = fixture({ status: 'withdrawn' }); assert.equal((await repeat.run()).status, 200); assert.equal(repeat.writes.length, 0);
});
test('withdrawal rejects another freelancer, accepted proposals, signed-out and cross-origin requests', async () => {
  for (const [options, expected] of [[{ uid: 'someone-else' }, 404], [{ status: 'accepted' }, 409], [{ signedIn: false }, 401], [{ sameOrigin: false }, 403]]) {
    const f = fixture(options); assert.equal((await f.run()).status, expected); assert.equal(f.writes.length, 0);
  }
});
