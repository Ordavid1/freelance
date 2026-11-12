import test from 'node:test';
import assert from 'node:assert/strict';
import { loadModule } from './helpers/load-ts.mjs';

const { parseXPlaceUrl, resolveXPlaceProfileUrl, xplaceProjectKey, XPLACE_ORIGIN } = loadModule('src/lib/imports/xplace/urls.ts');

// robots.txt of www.xplace.com as read on 2026-11-11 (User-agent: *). Re-check before widening the importer.
const ROBOTS_DISALLOW = [
  '/*jsessionid*', '/*jobs*?', '/*ShowWorkFromHome.xpl?lang=en', '/*ConfirmLanguage.xpl', '/*ShowArticleFile.xpl',
  '/*ShowBidFile.xpl', '/*ShowCompanyResume.xpl', '/*SelectWinner.xpl', '/*SearchProviders.xpl', '/*SearchProjects.xpl',
  '/*pay/', '/*ShowInviteProvider.xpl', '/*ShowProjectNDA.xpl', '/*AddFavoriteCompany.xpl', '/*rest/',
];
function robotsBlocks(pathAndQuery) {
  return ROBOTS_DISALLOW.some((rule) => {
    const anchored = rule.endsWith('$');
    const source = (anchored ? rule.slice(0, -1) : rule).replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
    return new RegExp(`^${source}${anchored ? '$' : ''}`).test(pathAndQuery);
  });
}

test('profile links in every supported form resolve to one canonical profile URL', () => {
  const forms = [
    'https://www.xplace.com/il/u/ordavidone', 'https://www.xplace.com/il/u/ordavidone/', 'https://xplace.com/il/u/ordavidone',
    'http://www.xplace.com/il/u/ordavidone', 'www.xplace.com/il/u/ordavidone', 'xplace.com/u/ordavidone', 'HTTPS://WWW.XPLACE.COM/il/en/u/ordavidone?utm_source=x#about',
    '  https://www.xplace.com/il/u/ordavidone  ',
  ];
  for (const form of forms) {
    const target = parseXPlaceUrl(form);
    assert.ok(target, form);
    assert.equal(target.kind, 'profile');
    assert.equal(target.slug, 'ordavidone');
    assert.equal(target.canonicalUrl, `${XPLACE_ORIGIN}/il/u/ordavidone`);
    assert.equal('fetchUrl' in target, false);
  }
});

test('both project URL formats share one ID and fetch the server-rendered project page', () => {
  for (const form of ['https://www.xplace.com/project?id=217664', 'https://www.xplace.com/il/job-bids/217664', 'xplace.com/job-bids/217664/', 'https://www.xplace.com/project?id=217664&utm_campaign=a']) {
    const target = parseXPlaceUrl(form);
    assert.ok(target, form);
    assert.deepEqual({ ...target }, {
      kind: 'project', projectId: '217664',
      canonicalUrl: 'https://www.xplace.com/il/job-bids/217664', fetchUrl: 'https://www.xplace.com/project?id=217664',
    });
  }
  assert.equal(xplaceProjectKey('217664'), 'xplace:project:217664');
});

test('anything that is not an exact XPlace profile or project page is rejected', () => {
  const rejected = [
    '', '   ', 'not a url', 'https://example.com/il/u/ordavidone', 'https://www.xplace.com.evil.com/il/u/ordavidone',
    'https://evilxplace.com/il/u/ordavidone', 'https://xplace.com@evil.com/il/u/ordavidone', 'https://user:pw@www.xplace.com/il/u/x1',
    'https://www.xplace.com:8443/il/u/ordavidone', 'ftp://www.xplace.com/il/u/ordavidone', 'javascript:alert(1)', 'file:///etc/passwd',
    'https://www.xplace.com/', 'https://www.xplace.com/il/u/', 'https://www.xplace.com/il/u/a', 'https://www.xplace.com/il/u/ordavidone/extra',
    'https://www.xplace.com/il/u/../rest/profile', 'https://www.xplace.com/il/u/%2e%2e', 'https://www.xplace.com/il/u/%E0%A4%A',
    'https://www.xplace.com/project', 'https://www.xplace.com/project?id=abc', 'https://www.xplace.com/project?id=0123', 'https://www.xplace.com/project?id=123',
    'https://www.xplace.com/project?id=12345678901', 'https://www.xplace.com/il/job-bids/12a4', 'https://www.xplace.com/il/job-bids/',
    'https://www.xplace.com/il/jobs?sort=amount_pj', 'https://www.xplace.com/il/rest/projects/217664', 'https://www.xplace.com/il/SearchProjects.xpl',
    `https://www.xplace.com/il/u/${'a'.repeat(100)}`, `https://www.xplace.com/${'x'.repeat(600)}`, null, undefined, 42, {},
  ];
  for (const value of rejected) assert.equal(parseXPlaceUrl(value), null, String(value).slice(0, 60));
});

test('profile targets carry no fetch URL: the server never requests profile pages', () => {
  assert.equal('fetchUrl' in parseXPlaceUrl('https://www.xplace.com/il/u/ordavidone'), false);
});

test('the importer only ever requests paths that robots.txt allows', () => {
  for (const form of ['https://www.xplace.com/il/job-bids/217664', 'https://www.xplace.com/project?id=217664']) {
    const { fetchUrl } = parseXPlaceUrl(form);
    const url = new URL(fetchUrl);
    assert.equal(url.protocol, 'https:');
    assert.equal(url.hostname, 'www.xplace.com');
    assert.equal(robotsBlocks(`${url.pathname}${url.search}`), false, fetchUrl);
  }
  // The self-check itself must be able to fail.
  assert.equal(robotsBlocks('/il/rest/profile/1'), true);
  assert.equal(robotsBlocks('/il/jobs?sort=x'), true);
});

test('resolveXPlaceProfileUrl accepts a bare username or a profile link and returns the canonical profile page', () => {
  const base = `${XPLACE_ORIGIN}/il/u/`;
  const accepted = [
    ['ordavidone', `${base}ordavidone`], [' ordavidone ', `${base}ordavidone`],
    ['https://www.xplace.com/il/u/ordavidone', `${base}ordavidone`], ['xplace.com/u/ordavidone?x=1', `${base}ordavidone`],
    ['john.doe', `${base}john.doe`], ['דוד_כהן', `${base}${encodeURIComponent('דוד_כהן')}`],
  ];
  for (const [input, expected] of accepted) assert.equal(resolveXPlaceProfileUrl(input), expected, input);
});

test('resolveXPlaceProfileUrl rejects everything else', () => {
  const rejected = [
    '', 'a', 'a'.repeat(81), 'has space', 'a/b', 'javascript:alert(1)', 'https://evil.example/il/u/x',
    'https://www.xplace.com/il/job-bids/123456', 'www.xplace.com', 'xplace.com', '-abc', 12345, null, undefined,
  ];
  for (const input of rejected) assert.equal(resolveXPlaceProfileUrl(input), null, String(input).slice(0, 40));
});
