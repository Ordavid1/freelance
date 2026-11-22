import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { loadModule, projectRoot } from './helpers/load-ts.mjs';

const { isReservedHandle } = loadModule('src/lib/headhunters/reserved.ts');
const METADATA = /^(opengraph-image|twitter-image|icon|apple-icon|favicon|sitemap|robots|manifest)\./i;
const stem = (name) => name.split('.')[0].toLowerCase();
const isSpecialDirectory = (name) => /^[([@_]/.test(name) && !name.startsWith('_next');

test('every top-level route, metadata file and public asset is a reserved handle', () => {
  const stems = new Set();
  for (const entry of readdirSync(path.join(projectRoot, 'src/app'), { withFileTypes: true })) {
    if (entry.isDirectory() && !isSpecialDirectory(entry.name) && !/^\[/.test(entry.name)) stems.add(stem(entry.name));
    if (entry.isFile() && METADATA.test(entry.name)) stems.add(stem(entry.name));
  }
  for (const entry of readdirSync(path.join(projectRoot, 'public'))) stems.add(stem(entry));
  assert.ok(stems.size >= 10, 'the route scan found the app');
  for (const name of stems) assert.equal(isReservedHandle(name), true, `"${name}" is served at the top level and must be in RESERVED_ROUTE_SEGMENTS`);
});

test('the scan would catch an unreserved route', () => {
  assert.equal(isReservedHandle('brand-new-route'), false);
});
