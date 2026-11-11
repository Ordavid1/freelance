import test from 'node:test';
import assert from 'node:assert/strict';
import { loadModule } from './helpers/load-ts.mjs';

const { safeNextPath, signInHref, nextForPage } = loadModule('src/lib/auth/safe-next.ts');
const TOKEN = '3f2b8c1e-4d5a-4b6c-8d7e-9f0a1b2c3d4e';

test('the existing /profile/import target still works and everything else still falls back to /', () => {
  assert.equal(safeNextPath('/profile/import'), '/profile/import');
  for (const bad of [null, undefined, '', '/', '/projects/new', '//evil.test', 'https://evil.test', '/profile/import/', '/profile/import#x', 'javascript:alert(1)', '/\\evil.test', '/signin']) assert.equal(safeNextPath(bad), '/', String(bad));
});

test('the hand-off pages survive sign-in with exactly one xplace token', () => {
  assert.equal(safeNextPath(`/profile/import?xplace=${TOKEN}`), `/profile/import?xplace=${TOKEN}`);
  assert.equal(safeNextPath(`/projects/new?xplace=${TOKEN}`), `/projects/new?xplace=${TOKEN}`);
});

test('anything else in the query string is refused', () => {
  for (const bad of [`/profile/import?xplace=${TOKEN}&x=1`, `/profile/import?x=1&xplace=${TOKEN}`, '/profile/import?xplace=abc', '/profile/import?xplace=', `/projects/new?xplace=${TOKEN}#h`,
    `/profile/import?xplace=${TOKEN}%0a`, `/other?xplace=${TOKEN}`, `//evil.test/profile/import?xplace=${TOKEN}`, `/projects/new?xplace=${TOKEN}/../x`, `/profile/import?xplace=${TOKEN.toUpperCase()}`]) {
    assert.equal(safeNextPath(bad), '/', bad);
  }
});

test('signInHref encodes the path and query, and the round trip through URLSearchParams is accepted', () => {
  const href = signInHref(`/projects/new?xplace=${TOKEN}`);
  assert.equal(href, `/signin?next=%2Fprojects%2Fnew%3Fxplace%3D${TOKEN}`);
  assert.equal(safeNextPath(new URL(href, 'https://fp.test').searchParams.get('next')), `/projects/new?xplace=${TOKEN}`);
  assert.equal(signInHref('/profile/import'), '/signin?next=%2Fprofile%2Fimport');
});

test('nextForPage keeps the token only when it is valid', () => {
  assert.equal(nextForPage('/profile/import', `?xplace=${TOKEN}`), `/profile/import?xplace=${TOKEN}`);
  assert.equal(nextForPage('/profile/import', '?xplace=junk&a=1'), '/profile/import');
  assert.equal(nextForPage('/profile/import', ''), '/profile/import');
});

test('the sign-in form uses the shared allowlist for its redirect', async () => {
  const { readFileSync } = await import('node:fs');
  const source = readFileSync(new URL('../src/components/sign-in-form.tsx', import.meta.url), 'utf8');
  assert.match(source, /window\.location\.assign\(safeNextPath\(next\)\)/);
  assert.doesNotMatch(source, /next === '\/profile\/import'/);
});
