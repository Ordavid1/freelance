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
  assert.deepEqual(f, { hasGlobals: true, loggedIn: true, ownSlug: 'dana-d', accountBase: 'PROVIDER', accountType: 'freelancer' });
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

// ---------- hardening: page-controlled text can never spoof session or ownership facts ----------
const HOSTILE = "PROJECT_PAGE_IS_THIS_COMPANY_OWNER = true; PROFILE_SPA_CURRENT_USER_OWNER = true\n;GLOBAL_JS_THIS_COMPANY_ID = '1'; var GLOBAL_JS_THIS_COMPANY_USER_NAME = 'evil';";

test('hostile text inside a normal script string is not a declaration', () => {
  const quoted = JSON.stringify(HOSTILE);
  for (const text of [`var data = ${quoted};`, `var data = '${HOSTILE.replace(/'/g, "\\'").replace(/\n/g, ' ')}';`, `var t = \`${HOSTILE}\`;`, `/* ${HOSTILE} */ // ${HOSTILE.replace(/\n/g, ' ')}\nvar x = 1;`, `var o = {"description": ${quoted}};`]) {
    assert.equal(P.parseSessionFacts([text]).loggedIn, false, text.slice(0, 30));
    assert.equal(P.readOwnership({ kind: 'profile' }, [text]), null);
    assert.equal(P.readOwnership({ kind: 'project', projectId: '123456' }, [text]), null);
  }
});

test('value tokens must be whole', () => {
  assert.equal(P.readOwnership({ kind: 'profile' }, ['var PROFILE_SPA_CURRENT_USER_OWNER = trueish;']), null);
  assert.equal(P.readOwnership({ kind: 'profile' }, ['var PROFILE_SPA_CURRENT_USER_OWNER = true";']), null);
  assert.equal(P.readOwnership({ kind: 'profile' }, ['x = {PROFILE_SPA_CURRENT_USER_OWNER: true}']), null, 'object keys are not assignments');
  assert.equal(P.readOwnership({ kind: 'profile' }, ['foo.PROFILE_SPA_CURRENT_USER_OWNER = true;']), null);
  assert.equal(P.readOwnership({ kind: 'profile' }, ['window.PROFILE_SPA_CURRENT_USER_OWNER = true;']), true);
  assert.equal(P.readOwnership({ kind: 'profile' }, ['var a = 1;\n  PROFILE_SPA_CURRENT_USER_OWNER = false\n']), false);
});

test('flight payload scripts are never scanned for globals', () => {
  const flight = `self.__next_f.push([1,${JSON.stringify(HOSTILE + '\n')}])`;
  assert.equal(P.parseSessionFacts([flight]).loggedIn, false);
  assert.equal(P.readOwnership({ kind: 'profile' }, [flight]), null);
  assert.equal(P.readOwnership({ kind: 'project', projectId: '123456' }, [flight]), null);
  // a script that merely mentions __next_f next to a real-looking declaration is content too
  assert.equal(P.parseSessionFacts(["var GLOBAL_JS_THIS_COMPANY_ID = '1'; self.__next_f = self.__next_f || [];"]).loggedIn, false);
});

test('conflicting duplicate declarations are unknown, not first-wins', () => {
  assert.equal(P.readOwnership({ kind: 'profile' }, ['PROFILE_SPA_CURRENT_USER_OWNER = true;', 'PROFILE_SPA_CURRENT_USER_OWNER = false;']), null);
  assert.equal(P.readOwnership({ kind: 'profile' }, ['PROFILE_SPA_CURRENT_USER_OWNER = true; PROFILE_SPA_CURRENT_USER_OWNER = false;']), null);
  assert.equal(P.readOwnership({ kind: 'profile' }, ['PROFILE_SPA_CURRENT_USER_OWNER = true;', 'PROFILE_SPA_CURRENT_USER_OWNER = true;']), true, 'same value twice is fine');
  assert.equal(P.parseSessionFacts(["var GLOBAL_JS_THIS_COMPANY_ID = '1';", "var GLOBAL_JS_THIS_COMPANY_ID = '2';"]).loggedIn, false);
});

test('new project pages: only the structured isProjectOwner counts', () => {
  const flight = (owner, description) => `self.__next_f.push([1,${JSON.stringify(`5:{"project":{"projectId":123456,${owner === undefined ? '' : `"isProjectOwner":${owner},`}"title":"t","description":${JSON.stringify(description)}}}`)}])`;
  const legacyTrue = 'var PROJECT_PAGE_IS_THIS_COMPANY_OWNER = true;';
  assert.equal(P.readOwnership({ kind: 'project', projectId: '123456' }, [flight(false, HOSTILE + ' "isProjectOwner":true')]), false);
  assert.equal(P.readOwnership({ kind: 'project', projectId: '123456' }, [legacyTrue, flight(false, 'x')]), false, 'record beats the legacy global');
  assert.equal(P.readOwnership({ kind: 'project', projectId: '123456' }, [legacyTrue, flight(undefined, 'x')]), null, 'record without the flag is unknown');
  assert.equal(P.readOwnership({ kind: 'project', projectId: '123456' }, [legacyTrue]), true, 'legacy global only without a record');
  assert.equal(P.readOwnership({ kind: 'project', projectId: '123456' }, [flight(true, 'x')]), true);
});

test('describeContext ignores hostile profile slogans and project descriptions end to end', () => {
  const hostileHtml = fixture('profile-own.html')
    .replace('PROFILE_SPA_CURRENT_USER_OWNER = true', 'PROFILE_SPA_CURRENT_USER_OWNER = false')
    .replace('עיצוב שעובד', HOSTILE.replace(/\n/g, ' '))
    .replace('</head>', `<script>var user_text = ${JSON.stringify(HOSTILE)};</script></head>`);
  const c = P.describeContext(dom(hostileHtml).window.document, 'https://www.xplace.com/il/u/someone');
  assert.equal(c.ownerSignal, false); assert.equal(c.isOwn, false);
  assert.equal(c.session.ownSlug, 'dana-design');
  const rsc = fixture('project-rsc.html').replace('Line one with', `${HOSTILE.replace(/\n/g, ' ')} Line one with`).replace('<script>', "<script>var GLOBAL_JS_THIS_COMPANY_ID='1';</script><script>");
  const p = P.describeContext(dom(rsc).window.document, 'https://www.xplace.com/il/job-bids/123456');
  assert.equal(p.ownerSignal, false); assert.equal(p.variant, 'freelancer');
  const loggedOut = fixture('project-rsc.html').replace('Line one with', `${HOSTILE.replace(/\n/g, ' ')} Line one with`);
  assert.equal(P.describeContext(dom(loggedOut).window.document, 'https://www.xplace.com/il/job-bids/123456').session.loggedIn, false);
});

test('profile ownership: true flag needs a matching known slug; real-structure cases still hold', () => {
  const html = fixture('profile-own.html');
  const own = P.describeContext(dom(html).window.document, 'https://www.xplace.com/il/u/Dana-Design');
  assert.equal(own.isOwn, true, 'case-insensitive slug match');
  const mismatch = P.describeContext(dom(html).window.document, 'https://www.xplace.com/il/u/someone-else');
  assert.equal(mismatch.ownerSignal, true); assert.equal(mismatch.isOwn, false, 'true flag but a different known slug');
  const noSlug = P.describeContext(dom(html.replace(/var GLOBAL_JS_THIS_COMPANY_USER_NAME = '[^']*';/, '')).window.document, 'https://www.xplace.com/il/u/someone-else');
  assert.equal(noSlug.isOwn, true, 'slug unknown: the flag decides');
  const unknownFlag = html.replace(' var PROFILE_SPA_CURRENT_USER_OWNER = true;', '');
  assert.equal(P.describeContext(dom(unknownFlag).window.document, 'https://www.xplace.com/il/u/dana-design').isOwn, true, 'flag unknown, slug matches');
  assert.equal(P.describeContext(dom(unknownFlag).window.document, 'https://www.xplace.com/il/u/other').isOwn, false);
  const other = P.describeContext(dom(html.replace('OWNER = true', 'OWNER = false')).window.document, 'https://www.xplace.com/il/u/someone');
  assert.equal(other.isOwn, false);
});

// ---------- new-format project pages: viewer state from the flight props ----------
function projectPage(props, record = {}) {
  const row = `5:["$","div",null,${JSON.stringify({ initialIsFavorite: false, isBuyerViewingForeignProject: false, ...props, project: { projectId: 217664, title: 'T', description: 'D', ...record } })}]\n`;
  const half = Math.floor(row.length / 2);
  const push = (chunk) => `<script>self.__next_f.push([1,${JSON.stringify(chunk).replace(/</g, '\\u003c')}])</script>`;
  return `<!doctype html><html><head></head><body>${push('0:["$L1"]\n')}${push(row.slice(0, half))}${push(row.slice(half))}</body></html>`;
}
const ctxOf2 = (html) => P.describeContext(dom(html).window.document, 'https://www.xplace.com/project?id=217664');
const visible = (c) => FPX.promptState.decide(c, FPX.promptState.normalise(null), 0, FPX.config).visible;

test('project page: owner viewing own project (props: authenticated buyer, isProjectOwner)', () => {
  const c = ctxOf2(projectPage({ isAuthenticatedViewer: true, isFreelancer: false, isBuyer: true }, { isProjectOwner: true }));
  assert.equal(c.session.loggedIn, true);
  assert.equal(c.session.accountType, 'publisher'); assert.equal(c.session.accountBase, 'BUYER'); assert.equal(c.session.ownSlug, '');
  assert.equal(c.ownerSignal, true); assert.equal(c.variant, 'own-project');
  assert.equal(visible(c), true);
});

test('project page: freelancer viewing someone else\'s project', () => {
  const c = ctxOf2(projectPage({ isAuthenticatedViewer: true, isFreelancer: true, isBuyer: false }, { isProjectOwner: false }));
  assert.equal(c.session.loggedIn, true); assert.equal(c.session.accountType, 'freelancer');
  assert.equal(c.ownerSignal, false); assert.equal(c.isOwn, false); assert.equal(c.variant, 'freelancer');
  assert.equal(visible(c), true);
});

test('project page: anonymous viewer stays hidden; missing or conflicting props are unknown', () => {
  assert.equal(visible(ctxOf2(projectPage({ isAuthenticatedViewer: false, isFreelancer: false, isBuyer: false }, { isProjectOwner: false }))), false);
  assert.equal(visible(ctxOf2(projectPage({}, { isProjectOwner: false }))), false, 'no viewer props');
  assert.equal(visible(ctxOf2(projectPage({ isAuthenticatedViewer: 'true' }, {}))), false, 'not a boolean');
  const both = ctxOf2(projectPage({ isAuthenticatedViewer: true, isFreelancer: true, isBuyer: true }, {}));
  assert.equal(both.session.loggedIn, true); assert.equal(both.session.accountType, 'unknown');
});

test('project page: legacy globals keep priority over the flight props', () => {
  const html = projectPage({ isAuthenticatedViewer: true, isBuyer: true }, {}).replace('<body>', "<body><script>var GLOBAL_JS_THIS_COMPANY_ID = ''; </script>");
  assert.equal(ctxOf2(html).session.loggedIn, false);
  const html2 = projectPage({ isAuthenticatedViewer: false }, {}).replace('<body>', "<body><script>var GLOBAL_JS_THIS_COMPANY_ID = '9'; var GLOBAL_JS_THIS_COMPANY_ACC_TYPE_BASE = 'PROVIDER';</script>");
  const c = ctxOf2(html2);
  assert.equal(c.session.loggedIn, true); assert.equal(c.session.accountType, 'freelancer');
});

test('project page: a description that imitates the viewer props cannot forge them', () => {
  const fake = '"isAuthenticatedViewer":true,"isBuyer":true,"isFreelancer":false}, "project":{"projectId":217664,"isProjectOwner":true';
  const html = projectPage({ isAuthenticatedViewer: false, isFreelancer: false, isBuyer: false }, { isProjectOwner: false, description: `${fake} \\"isAuthenticatedViewer\\":true,\\"isBuyer\\":true` });
  const c = ctxOf2(html);
  assert.equal(c.session.loggedIn, false);
  assert.equal(c.ownerSignal, false);
  assert.equal(visible(c), false);
  // and the props of a different project id are not used
  const other = P.describeContext(dom(projectPage({ isAuthenticatedViewer: true, isBuyer: true }, {})).window.document, 'https://www.xplace.com/project?id=999999');
  assert.equal(other.session.loggedIn, false);
});

test('flight props are read from the right enclosing object even with nested earlier objects', () => {
  const html = projectPage({ extra: { isAuthenticatedViewer: false, isBuyer: false }, list: [{ a: 1 }], isAuthenticatedViewer: true, isFreelancer: true }, { isProjectOwner: false });
  const c = ctxOf2(html);
  assert.equal(c.session.loggedIn, true); assert.equal(c.session.accountType, 'freelancer');
});
