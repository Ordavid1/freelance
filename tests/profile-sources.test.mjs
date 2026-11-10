import { loadModule } from './helpers/load-ts.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { NextResponse } from 'next/server.js';

function sourceRoute() {
  const rows = [
    { id: 'older', name: 'Older.pdf', size: 100, createdAt: { toMillis: () => 100 } },
    { id: 'newer', name: 'Newer.txt', size: 20, createdAt: { toMillis: () => 200 } },
    { id: 'dribbble', import: {} },
  ];
  const query = {
    where(field, op, value) { assert.deepEqual([field, op, value], ['status', '==', 'ready']); return this; },
    orderBy() { throw new Error('FAILED_PRECONDITION: The query requires an index'); },
    limit() { return this; },
    async get() { return { docs: rows.map((row) => ({ id: row.id, get: (field) => row[field] })) }; },
  };
  const module = { exports: {} };
  const stubs = {
    '@/lib/security/request-body': loadModule('src/lib/security/request-body.ts'),
    '@/lib/security/rate-limit': { enforceActionLimit: async () => null },
    'node:crypto': {}, 'firebase-admin/firestore': {}, 'next/server': { NextResponse },
    '@/lib/auth/session': { getCurrentUser: async () => ({ uid: 'owner' }) },
    '@/lib/db/firestore': { firestore: () => ({ collection: () => ({ doc: () => ({ collection: () => query }) }) }) },
    '@/lib/db/storage': {},
  };
  const code = ts.transpileModule(readFileSync(new URL('../src/app/api/uploads/profile-source/route.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(code, { module, exports: module.exports, require(name) { if (name in stubs) return stubs[name]; throw new Error(name); } });
  return module.exports;
}

test('ready file sources load newest first without a compound Firestore index', async () => {
  const response = await sourceRoute().GET();
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { sources: [
    { id: 'newer', name: 'Newer.txt', size: 20 },
    { id: 'older', name: 'Older.pdf', size: 100 },
  ] });
});
