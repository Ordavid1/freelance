import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadModule, projectRoot } from './helpers/load-ts.mjs';

// Values created inside the loader's vm context have foreign prototypes; compare plain copies.
const plain = (value) => JSON.parse(JSON.stringify(value));
const asList = (value) => (value === undefined ? [] : [].concat(value));
const { SITE_URL } = loadModule('src/lib/seo/site.ts');
const registry = loadModule('src/lib/seo/crawlers.ts');
const { crawlers } = registry;
const production = { SITE_INDEXABLE: 'true' };
const robotsFor = (env) => loadModule('src/app/robots.ts', { env }).default();

// The tokens verified against operator documentation. Add a token here only together with its
// registry entry, the documentation URL it was checked against and the check date.
const VERIFIED = {
  'search-index': ['Googlebot', 'bingbot', 'OAI-SearchBot', 'PerplexityBot', 'Claude-SearchBot', 'Amzn-SearchBot', 'meta-webindexer', 'Applebot', 'DuckAssistBot', 'YouBot', 'MistralAI-Index'],
  'user-triggered': ['ChatGPT-User', 'Claude-User', 'Perplexity-User', 'meta-externalfetcher', 'MistralAI-User', 'Amzn-User'],
  training: ['GPTBot', 'ClaudeBot', 'Google-Extended', 'Applebot-Extended', 'CCBot', 'meta-externalagent', 'Amazonbot', 'MistralAI-Training'],
};

// A crawler uses only the most specific group that names it, otherwise the `*` group (RFC 9309).
function groupFor(robots, token) {
  const rules = asList(robots.rules);
  return rules.find((rule) => asList(rule.userAgent).some((agent) => agent.toLowerCase() === token.toLowerCase()))
    ?? rules.find((rule) => asList(rule.userAgent).includes('*'));
}
// RFC 9309: the longest matching path wins, allow wins a tie, no match means allowed.
function allowed(group, path) {
  let best = { length: -1, allow: true };
  for (const [allow, patterns] of [[true, group.allow], [false, group.disallow]]) {
    for (const pattern of asList(patterns)) {
      if (path.startsWith(pattern) && (pattern.length > best.length || (pattern.length === best.length && allow))) best = { length: pattern.length, allow };
    }
  }
  return best.allow;
}
const PUBLIC_PATHS = ['/', '/projects/example-project', '/categories/design', '/guides/project-brief', '/messages', '/_next/static/chunks/app.js', '/llms.txt'];

test('registry lists only verified tokens, each with operator, group, documentation and check date', () => {
  const byGroup = {};
  for (const crawler of crawlers) (byGroup[crawler.group] ??= []).push(crawler.token);
  assert.deepEqual(plain(Object.fromEntries(Object.entries(byGroup).map(([group, tokens]) => [group, [...tokens].sort()]))),
    Object.fromEntries(Object.entries(VERIFIED).map(([group, tokens]) => [group, [...tokens].sort()])));
  const tokens = crawlers.map((crawler) => crawler.token.toLowerCase());
  assert.equal(new Set(tokens).size, tokens.length, 'tokens are unique (case-insensitive)');
  for (const crawler of crawlers) {
    // RFC 9309 product tokens: letters, hyphen and underscore only.
    assert.match(crawler.token, /^[A-Za-z_-]+$/, crawler.token);
    assert.ok(crawler.operator.trim(), `${crawler.token} operator`);
    assert.ok(crawler.purpose.trim() && !/\n/.test(crawler.purpose), `${crawler.token} purpose is one line`);
    const docs = new URL(crawler.docs);
    assert.equal(docs.protocol, 'https:', `${crawler.token} docs`);
    assert.ok(!docs.username && !docs.password, `${crawler.token} docs carry no credentials`);
    assert.match(crawler.checked, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(new Date(`${crawler.checked}T00:00:00Z`).toISOString().startsWith(crawler.checked), true, `${crawler.token} check date`);
  }
  // Tokens the operator does not document are not listed.
  for (const dropped of ['cohere-ai', 'Bytespider']) assert.equal(tokens.includes(dropped.toLowerCase()), false, dropped);
});

test('crawlerPolicy allows training crawlers by default and fails closed on an unreadable opt-out', () => {
  const policy = (value) => plain(registry.crawlerPolicy(value === undefined ? {} : { AI_TRAINING_CRAWLERS: value }));
  assert.deepEqual(policy(undefined), { training: 'allow' });
  for (const value of ['', '  ', 'allow', 'ALLOW', ' Allow ']) assert.deepEqual(policy(value), { training: 'allow' }, JSON.stringify(value));
  for (const value of ['disallow', 'Disallow', ' DISALLOW ']) assert.deepEqual(policy(value), { training: 'disallow' }, JSON.stringify(value));
  for (const value of ['block', 'false', 'no', 'alow', 'true']) assert.deepEqual(policy(value), { training: 'disallow' }, `${value} is not consent`);
  const runtime = loadModule('src/lib/seo/crawlers.ts', { env: { AI_TRAINING_CRAWLERS: 'disallow' } });
  assert.deepEqual(plain(runtime.crawlerPolicy()), { training: 'disallow' }, 'defaults to process.env');
  const search = crawlers.find((crawler) => crawler.group === 'search-index');
  const user = crawlers.find((crawler) => crawler.group === 'user-triggered');
  const training = crawlers.find((crawler) => crawler.group === 'training');
  for (const training_ of ['allow', 'disallow']) {
    assert.equal(registry.crawlerAccess(search, { training: training_ }), 'allow');
    assert.equal(registry.crawlerAccess(user, { training: training_ }), 'allow');
    assert.equal(registry.crawlerAccess(training, { training: training_ }), training_);
  }
  assert.deepEqual(plain(registry.crawlersInGroup('training').map((crawler) => crawler.token)), VERIFIED.training);
});

test('robots.txt: the wildcard group plus one explicit group per crawler, each repeating the disallow list', () => {
  const robots = robotsFor(production);
  assert.ok(Array.isArray(robots.rules));
  const [star, ...named] = robots.rules;
  assert.equal(star.userAgent, '*');
  assert.equal(star.allow, '/');
  assert.deepEqual(plain(star.disallow), ['/api/']);
  assert.equal(robots.sitemap, `${SITE_URL}/sitemap.xml`);
  assert.deepEqual(plain(named.map((rule) => rule.userAgent)), plain(crawlers.map((crawler) => crawler.token)), 'one group per token, in registry order');
  for (const group of named) {
    assert.equal(group.allow, '/', group.userAgent);
    // A crawler that has its own group ignores `*`, so the restrictions must be repeated in it.
    assert.deepEqual(plain(group.disallow), plain(star.disallow), `${group.userAgent} repeats the wildcard disallow list`);
  }
});

test('robots.txt: every documented crawler may read public pages and render assets but not the API', () => {
  const robots = robotsFor(production);
  for (const crawler of crawlers) {
    const group = groupFor(robots, crawler.token);
    assert.equal(asList(group.userAgent).includes(crawler.token), true, `${crawler.token} resolves to its own group`);
    for (const path of PUBLIC_PATHS) assert.equal(allowed(group, path), true, `${crawler.token} ${path}`);
    assert.equal(allowed(group, '/api/marketplace/projects'), false, `${crawler.token} /api/`);
  }
  // Unlisted crawlers keep using the wildcard group.
  const other = groupFor(robots, 'SomeOtherBot');
  assert.equal(asList(other.userAgent).includes('*'), true);
  assert.equal(allowed(other, '/api/auth/session'), false);
  assert.equal(allowed(other, '/'), true);
  // Account pages stay crawlable so engines can read their noindex directive.
  for (const path of ['/signin', '/messages', '/membership', '/profile', '/projects/new']) assert.equal(allowed(groupFor(robots, 'bingbot'), path), true, path);
});

test('robots.txt: AI_TRAINING_CRAWLERS=disallow closes only the training crawlers', () => {
  for (const value of ['disallow', 'Disallow', 'not-a-valid-value']) {
    const robots = robotsFor({ ...production, AI_TRAINING_CRAWLERS: value });
    const [star, ...named] = robots.rules;
    assert.deepEqual(plain(star), { userAgent: '*', allow: '/', disallow: ['/api/'] }, 'the wildcard group is unchanged');
    assert.equal(robots.sitemap, `${SITE_URL}/sitemap.xml`);
    assert.deepEqual(plain(named.map((rule) => rule.userAgent)), plain(crawlers.map((crawler) => crawler.token)));
    for (const crawler of crawlers) {
      const group = groupFor(robots, crawler.token);
      if (crawler.group === 'training') {
        assert.deepEqual(plain(group), { userAgent: crawler.token, disallow: '/' }, crawler.token);
        for (const path of ['/', ...PUBLIC_PATHS]) assert.equal(allowed(group, path), false, `${crawler.token} ${path}`);
      } else {
        assert.equal(group.allow, '/', crawler.token);
        assert.deepEqual(plain(group.disallow), ['/api/'], crawler.token);
        for (const path of PUBLIC_PATHS) assert.equal(allowed(group, path), true, `${crawler.token} ${path}`);
      }
    }
  }
  // Explicit allow is the same as the default.
  assert.deepEqual(plain(robotsFor({ ...production, AI_TRAINING_CRAWLERS: 'allow' })), plain(robotsFor(production)));
});

test('robots.txt: previews and non-indexable deployments are closed to every crawler', () => {
  for (const env of [{}, { SITE_INDEXABLE: 'false' }, { SITE_INDEXABLE: 'TRUE' }, { AI_TRAINING_CRAWLERS: 'allow' }, { SITE_INDEXABLE: '', AI_TRAINING_CRAWLERS: 'allow' }]) {
    const robots = robotsFor(env);
    assert.equal(Array.isArray(robots.rules), false, JSON.stringify(env));
    assert.deepEqual(plain(robots.rules), { userAgent: '*', disallow: '/' });
    assert.equal(robots.sitemap, undefined, 'no sitemap is advertised from a preview');
    // No named group exists, so every documented crawler falls back to the closed wildcard group.
    for (const crawler of crawlers) {
      const group = groupFor(robots, crawler.token);
      assert.equal(asList(group.userAgent).includes('*'), true, crawler.token);
      for (const path of ['/', ...PUBLIC_PATHS]) assert.equal(allowed(group, path), false, `${crawler.token} ${path}`);
    }
  }
});

test('crawler policy code takes the site URL from site.ts and never hard-codes an origin', () => {
  for (const file of ['src/app/robots.ts', 'src/lib/seo/crawlers.ts']) {
    assert.doesNotMatch(readFileSync(`${projectRoot}/${file}`, 'utf8'), /freelance-place\.com|localhost/, file);
  }
});
