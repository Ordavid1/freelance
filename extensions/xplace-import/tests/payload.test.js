'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { FPX } = require('./helpers/load');
const V = FPX.payload.validateCapturedPayload;

const base = { kind: 'profile', url: 'https://www.xplace.com/il/u/a', ownerSignal: true, headline: 'h', slogan: '', location: '', about: 'a', languages: [], expertise: [], employment: [], education: [], otherSections: [], links: [] };

test('rebuilds only allowed keys and drops extras', () => {
  const r = V({ ...base, phone: '0500000000', employment: [{ position: 'p', company: 'c', period: '', description: '', secret: 'x' }] });
  assert.equal(r.ok, true);
  assert.ok(!('phone' in r.payload));
  assert.ok(!('secret' in r.payload.employment[0]));
});
test('invalid shapes', () => {
  for (const bad of [null, [], 'x', { kind: 'other' }, { ...base, url: '' }]) assert.equal(V(bad).code, 'invalid');
});
test('empty profile and project', () => {
  assert.equal(V({ ...base, headline: '', about: '' }).code, 'empty');
  assert.equal(V({ kind: 'project', url: 'u', projectId: '123456', title: '', description: 'd' }).code, 'empty');
});
test('size cap', () => {
  const big = { ...base, about: 'x'.repeat(1500), otherSections: Array.from({ length: 5 }, () => ({ section: 'courses', entries: Array.from({ length: 10 }, () => 'y'.repeat(300)) })) };
  assert.equal(V(big).ok, true);
  assert.equal(V(big, { maxBytes: 1000 }).code, 'too-large');
});
test('caps lists and rejects non-http links', () => {
  const r = V({ ...base, languages: Array.from({ length: 20 }, (_, i) => ({ name: `l${i}`, level: '' })), links: [{ url: 'javascript:alert(1)', title: 't' }, { url: 'https://a.example', title: 't' }] });
  assert.equal(r.payload.languages.length, 8);
  assert.equal(r.payload.links.length, 1);
});

test('cleanText is linear on hostile markup and still strips encoded tags', () => {
  const { cleanText } = FPX.clean;
  for (const hostile of ['<a'.repeat(20000), '<!--'.repeat(10000), '<'.repeat(30000), '<script '.repeat(8000), '</a'.repeat(20000)]) {
    const t0 = process.hrtime.bigint();
    cleanText(hostile, 500);
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    assert.ok(ms < 100, `${hostile.slice(0, 8)} took ${ms}ms`);
  }
  assert.equal(cleanText('&lt;script&gt;steal()&lt;/script&gt; ok', 100), 'ok');
  assert.equal(cleanText('a<!-- c -->b <b>x</b> <script>alert(1)</script>y <style>p{}</style>z', 100), 'ab x y z');
  assert.equal(cleanText('5 < 6 and <b', 100), '5 < 6 and <b');
  assert.equal(cleanText('x <img src=x onerror=alert(1)> y', 100), 'x y');
});
