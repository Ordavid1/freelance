import test from 'node:test';
import assert from 'node:assert/strict';
import { loadModule } from './helpers/load-ts.mjs';
const { feedUniverse, filterFeed, countAvailable, countTagMatches } = loadModule('src/lib/projects/feed.ts');

const NOW = Date.parse('2026-11-12T08:00:00Z');
const mk = (slug, skills, over = {}) => ({ slug, title: `פרויקט ${slug}`, description: 'תיאור', skills, posted: 'פרויקט חדש', status: 'open', createdAt: NOW - 1000, ...over });
const feed = [
  mk('a', ['WordPress']), mk('b', ['Figma']), mk('c', ['WordPress'], { status: 'closed' }),
  mk('d', ['Python'], { createdAt: NOW - 40 * 24 * 3600 * 1000 }), mk('e', ['React'], { status: undefined, createdAt: undefined, posted: 'לפני 3 שעות' }),
];
const tags = ['וורדפרס', 'Figma', 'Python', 'React', 'SEO', 'Unity', 'Copywriting'];

test('tag-filter number counts matching projects, not profile tags', () => {
  const n = countTagMatches(feed, { tags, now: NOW });
  assert.equal(n, 5);
  assert.notEqual(n, tags.length);
  assert.equal(countTagMatches(feed, { tags: [], now: NOW }), 0);
});

test('the count equals what the filter shows under the same criteria', () => {
  for (const criteria of [{ status: 'open' }, { status: 'closed' }, { period: 'week' }, { query: 'a' }, {}]) {
    const c = { ...criteria, tags, includeAdjacent: true, now: NOW };
    assert.equal(countTagMatches(feed, c), filterFeed(feed, { ...c, matchTags: true }).length);
  }
});

test('with the open status the tag count can never exceed the available count', () => {
  assert.ok(countTagMatches(feed, { status: 'open', tags, now: NOW }) <= countAvailable(feed));
  assert.equal(countAvailable(feed), 4);
});

test('universe merges lists without duplicate slugs', () => {
  assert.equal(feedUniverse(feed, [mk('a', []), mk('z', [])]).map(p => p.slug).join(), ['a', 'b', 'c', 'd', 'e', 'z'].join());
});
