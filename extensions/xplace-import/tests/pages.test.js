'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { FPX, dom, fixture } = require('./helpers/load');
const P = FPX.pages;

test('page kind table', () => {
  const rows = [
    ['https://www.xplace.com/il/u/dana', { kind: 'profile', slug: 'dana' }],
    ['https://xplace.com/u/dana', { kind: 'profile', slug: 'dana' }],
    ['https://www.xplace.com/il/en/u/dana?x=1', { kind: 'profile', slug: 'dana' }],
    ['https://www.xplace.com/il/job-bids/123456', { kind: 'project', projectId: '123456', legacy: false }],
    ['https://xplace.com/job-bids/123456/', { kind: 'project', projectId: '123456', legacy: false }],
    ['https://www.xplace.com/project?id=123456', { kind: 'project', projectId: '123456', legacy: true }],
    ['https://www.xplace.com/project?id=12', { kind: 'other' }],
    ['https://www.xplace.com/il/', { kind: 'other' }],
    ['https://www.xplace.com/il/projects/search', { kind: 'other' }],
    ['http://www.xplace.com/il/u/dana', null],
    ['https://evil.com/il/u/dana', null],
    ['https://www.xplace.com.evil.com/il/u/dana', null],
    ['https://user:pw@www.xplace.com/il/u/dana', null],
    ['not a url', null],
  ];
  for (const [href, want] of rows) assert.deepEqual(P.parsePage(href), want, href);
});

test('session facts from inline scripts', () => {
  const f = P.parseSessionFacts([`var GLOBAL_JS_THIS_COMPANY_ID = '77'; var GLOBAL_JS_THIS_COMPANY_USER_NAME="dana-d"; var GLOBAL_JS_THIS_COMPANY_ACC_TYPE_BASE = 'PROVIDER';`]);
  assert.deepEqual(f, { loggedIn: true, ownSlug: 'dana-d', accountBase: 'PROVIDER', accountType: 'freelancer' });
  assert.equal(P.parseSessionFacts(["window.GLOBAL_JS_THIS_COMPANY_ID = 5; GLOBAL_JS_THIS_COMPANY_ACC_TYPE_BASE = 'COMPANY'"]).accountType, 'publisher');
  assert.equal(P.parseSessionFacts(['var GLOBAL_JS_THIS_COMPANY_ID = "";']).loggedIn, false);
  assert.equal(P.parseSessionFacts(['var GLOBAL_JS_THIS_COMPANY_ID = null;']).loggedIn, false);
  assert.equal(P.parseSessionFacts(['nothing here']).loggedIn, false);
  assert.equal(P.parseSessionFacts(["var GLOBAL_JS_THIS_COMPANY_ID='1'; var GLOBAL_JS_THIS_COMPANY_USER_NAME='a b/c';"]).ownSlug, '');
  // personal-name globals are never part of the result
  const withNames = P.parseSessionFacts(["var GLOBAL_JS_THIS_COMPANY_ID='1'; var GLOBAL_JS_THIS_COMPANY_FIRST_NAME='CANARY_FIRST';"]);
  assert.ok(!JSON.stringify(withNames).includes('CANARY'));
});

test('ownership flags: profile, legacy project, new project JSON', () => {
  assert.equal(P.readOwnership({ kind: 'profile' }, ['PROFILE_SPA_CURRENT_USER_OWNER = true;']), true);
  assert.equal(P.readOwnership({ kind: 'profile' }, ['var PROFILE_SPA_CURRENT_USER_OWNER = false']), false);
  assert.equal(P.readOwnership({ kind: 'profile' }, ['nothing']), null);
  assert.equal(P.readOwnership({ kind: 'project', projectId: '123456' }, ['var PROJECT_PAGE_IS_THIS_COMPANY_OWNER = true;']), true);
  const flight = (owner) => `self.__next_f.push([1,"5:{\\"project\\":{\\"projectId\\":123456,\\"isProjectOwner\\":${owner},\\"title\\":\\"t\\"}}"])`;
  assert.equal(P.readOwnership({ kind: 'project', projectId: '123456' }, [flight(true)]), true);
  assert.equal(P.readOwnership({ kind: 'project', projectId: '123456' }, [flight(false)]), false);
  assert.equal(P.readOwnership({ kind: 'project', projectId: '999999' }, [flight(true)]), null, 'other project id');
});

test('describeContext picks the variant', () => {
  const html = fixture('profile-own.html');
  const own = P.describeContext(dom(html).window.document, 'https://www.xplace.com/il/u/dana-design');
  assert.equal(own.isOwn, true); assert.equal(own.variant, 'freelancer'); assert.equal(own.session.ownSlug, 'dana-design');
  const other = P.describeContext(dom(html.replace('OWNER = true', 'OWNER = false')).window.document, 'https://www.xplace.com/il/u/someone');
  assert.equal(other.isOwn, false); assert.equal(other.ownerSignal, false);
  const pub = P.describeContext(dom(html.replace("'PROVIDER'", "'COMPANY'")).window.document, 'https://www.xplace.com/il/');
  assert.equal(pub.variant, 'publisher');
  const proj = fixture('project-rsc.html').replace('\\"isProjectOwner\\":false', '\\"isProjectOwner\\":true');
  const withSession = proj.replace('<script>', "<script>var GLOBAL_JS_THIS_COMPANY_ID='1';</script><script>");
  const own2 = P.describeContext(dom(withSession).window.document, 'https://www.xplace.com/il/job-bids/123456');
  assert.equal(own2.variant, 'own-project');
  assert.equal(P.describeContext(dom(html).window.document, 'https://evil.com/'), null);
});
