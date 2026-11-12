import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server.js';
import { loadModule } from './helpers/load-ts.mjs';
import { createFakeFirestore } from './helpers/fake-firestore.mjs';

const errorsModule = loadModule('src/lib/imports/errors.ts');
console.info = () => {};
const user = { uid: 'secret-uid-123', name: 'Account Name', email: 'person@example.com' };
const PROFILE_URL = 'https://www.xplace.com/il/u/some-freelancer';
const PROJECT_URL = 'https://www.xplace.com/il/job-bids/123456';

function setup({ enabled = true, linkEnabled = false, sameOrigin = true, currentUser = user, limit = null, profileDoc, profileReadFails = false } = {}) {
  const calls = { limiter: [] };
  const db = createFakeFirestore(profileDoc ? { profiles: { [user.uid]: profileDoc } } : {});
  if (profileReadFails) db.collection = () => ({ doc: () => ({ get: async () => { throw new Error('boom'); } }) });
  const route = loadModule('src/app/api/integrations/xplace/ingest/route.ts', {
    env: { XPLACE_IMPORT_ENABLED: enabled ? 'true' : 'false', XPLACE_LINK_IMPORT_ENABLED: linkEnabled ? 'true' : 'false' },
    stubs: {
      'next/server': { NextResponse },
      'node:crypto': { createHash },
      '@/lib/auth/session': { getCurrentUser: async () => currentUser, isSameOrigin: () => sameOrigin },
      '@/lib/db/firestore': { firestore: () => db },
      '@/lib/security/rate-limit': { enforceActionLimit: async (...args) => { calls.limiter.push(args); return limit; } },
      '@/lib/imports/errors': errorsModule,
    },
  });
  return { route, calls };
}
const post = (route, body) => route.POST(new Request('https://example.test/api/integrations/xplace/ingest', { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) }));
const profile = (extra = {}) => ({
  kind: 'profile', url: PROFILE_URL, ownerSignal: true, headline: 'מפתחת Full Stack', slogan: 'Build things', location: 'חיפה, ישראל', about: 'אני בונה מוצרים.\nI build products.',
  languages: [{ name: 'עברית', level: 'שפת אם' }], expertise: [{ industry: 'פיתוח', name: 'React, Node.js, react', description: 'ממשקים' }],
  employment: [{ period: '2020 - היום', position: 'מפתחת בכירה', company: 'Acme', description: 'ניהול צוות' }],
  education: [{ period: '2015 - 2018', degree: 'B.Sc', institution: 'הטכניון', description: '' }],
  otherSections: [{ section: 'courses', entries: ['Kubernetes basics'] }], links: [{ url: 'https://example.com/me', title: 'Portfolio', description: '' }], ...extra,
});
const project = (extra = {}) => ({ kind: 'project', url: PROJECT_URL, ownerSignal: false, projectId: '123456', title: 'בניית אתר', description: 'תיאור מלא של הפרויקט', amount: 5000, dueDate: '2026-12-31', categories: ['פיתוח אתרים, עיצוב', 'עיצוב'], publisherName: 'Acme Studio', ...extra });
const ask = (route, payload, attested = true) => post(route, { payload, attested });
const json = (response) => response.json();

test('flag off: IMPORT_DISABLED before anything else; the link flag is not needed', async () => {
  const off = setup({ enabled: false, sameOrigin: false, currentUser: null });
  const response = await post(off.route, '{unread');
  assert.equal(response.status, 503);
  assert.equal((await json(response)).code, 'IMPORT_DISABLED');
  assert.equal(off.calls.limiter.length, 0);
  const on = setup({ linkEnabled: false });
  assert.equal((await ask(on.route, profile())).status, 200);
});

test('cross-origin 403, unauthenticated 401, malformed and oversized bodies are rejected before the limiter', async () => {
  let { route, calls } = setup({ sameOrigin: false });
  assert.equal((await ask(route, profile())).status, 403);
  ({ route } = setup({ currentUser: null }));
  const unauth = await ask(route, profile());
  assert.equal(unauth.status, 401);
  assert.equal((await json(unauth)).error, 'יש להתחבר כדי לייבא מ־XPlace.');
  ({ route, calls } = setup());
  assert.equal((await post(route, '{bad')).status, 400);
  assert.equal((await post(route, '[]')).status, 400);
  const huge = await post(route, JSON.stringify({ payload: { kind: 'profile', url: PROFILE_URL, about: 'x'.repeat(310_000) }, attested: true }));
  assert.equal(huge.status, 413);
  assert.equal(calls.limiter.length, 0);
});

test('attestation is required for every kind, before validation and the limiter', async () => {
  for (const payload of [profile(), project(), { kind: 'profile-text', text: 'x'.repeat(100) }]) {
    for (const attested of [undefined, false, 'true', 1]) {
      const { route, calls } = setup();
      const response = await post(route, { payload, ...(attested === undefined ? {} : { attested }) });
      assert.equal(response.status, 400);
      assert.equal((await json(response)).code, 'ATTESTATION_REQUIRED');
      assert.equal(response.headers.get('Cache-Control'), 'no-store');
      assert.equal(calls.limiter.length, 0);
    }
  }
});

test('invalid payloads map to INVALID_PAYLOAD (400, Hebrew message) without touching the limiter', async () => {
  const bad = [undefined, null, 'x', 5, [], {}, { kind: 'other' }, { kind: 7 }, { kind: 'profile-text', text: 5 },
    profile({ ownerSignal: 'yes' }), profile({ headline: 5 }), profile({ employment: 'x' }), profile({ employment: [5] }), profile({ languages: { a: 1 } }), profile({ otherSections: [{ section: 'courses', entries: 'x' }] }),
    project({ projectId: {} }), project({ projectId: '999999' }), project({ amount: '5000' }), project({ amount: null, dueDate: 5 }), project({ categories: 'x' }), project({ categories: [1] }), project({ title: 5 })];
  for (const payload of bad) {
    const { route, calls } = setup();
    const response = await ask(route, payload);
    assert.equal(response.status, 400, JSON.stringify(payload));
    const body = await json(response);
    assert.equal(body.code, 'INVALID_PAYLOAD');
    assert.equal(body.error, 'המידע שנקלט מהתוסף אינו תקין. נסו לייבא שוב.');
    assert.equal(calls.limiter.length, 0);
  }
});

test('the page URL must be an XPlace URL of the declared kind (INVALID_URL)', async () => {
  const bad = [profile({ url: PROJECT_URL }), project({ url: PROFILE_URL }), profile({ url: 'https://evil.example/il/u/x' }), profile({ url: 'https://www.xplace.com.evil.test/il/u/x' }), profile({ url: 42 }), profile({ url: undefined }), project({ url: 'https://www.xplace.com/rest/project/123456' })];
  for (const payload of bad) {
    const { route, calls } = setup();
    const response = await ask(route, payload);
    assert.equal(response.status, 400, JSON.stringify(payload));
    assert.equal((await json(response)).code, 'INVALID_URL');
    assert.equal(calls.limiter.length, 0);
  }
});

test('a limited account gets the limiter response; the action is import.xplace.ingest and it runs after validation', async () => {
  const limited = Response.json({ code: 'RATE_LIMITED' }, { status: 429, headers: { 'Retry-After': '9' } });
  const { route, calls } = setup({ limit: limited });
  assert.equal(await ask(route, profile()), limited);
  assert.deepEqual(calls.limiter, [[user.uid, 'import.xplace.ingest']]);
});

test('the ingest limit is registered: 20 per 10 minutes, 120 per day', async () => {
  const { readFileSync } = await import('node:fs');
  assert.match(readFileSync(new URL('../src/lib/security/rate-limit.ts', import.meta.url), 'utf8'), /'import\.xplace\.ingest': \[\{ windowMs: 10 \* MINUTE, max: 20 \}, \{ windowMs: DAY, max: 120 \}\]/);
});

test('profile success: shape, counts, owner signal echo, no-store, name left empty', async () => {
  const { route, calls } = setup();
  const response = await ask(route, profile());
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  const body = await json(response);
  assert.equal(body.provider, 'xplace');
  assert.equal(body.url, PROFILE_URL);
  assert.equal(body.captured, 'extension');
  assert.equal(body.ownerSignal, true);
  assert.deepEqual(body.counts, { expertise: 1, employment: 1, education: 1 });
  assert.deepEqual(body.profile, {
    name: '', headline: 'מפתחת Full Stack', bio: 'אני בונה מוצרים.\nI build products.', skills: ['React', 'Node.js'],
    portfolio: 'Portfolio: https://example.com/me', experience: '2020 - היום · מפתחת בכירה, Acme', education: '2015 - 2018 · B.Sc, הטכניון',
  });
  assert.ok(body.sourceText.startsWith('XPlace profile (captured from the owner\'s own page)\nProfile URL: ' + PROFILE_URL));
  for (const piece of ['Headline: מפתחת Full Stack', 'Location: חיפה, ישראל', 'Employment:', 'Courses:', 'Kubernetes basics']) assert.ok(body.sourceText.includes(piece), piece);
  assert.deepEqual(body.warnings, []);
  assert.equal(new Date(body.fetchedAt).toString() === 'Invalid Date', false);
  assert.deepEqual(calls.limiter, [[user.uid, 'import.xplace.ingest']]);
  assert.equal((await json(await ask(setup().route, profile({ ownerSignal: undefined })))).ownerSignal, null);
});

test('unknown keys and canary values in extra fields are dropped everywhere', async () => {
  const { route } = setup();
  const payload = profile({
    phone: 'CANARY-PHONE', reviews: ['CANARY-REVIEW'], viewers: [{ name: 'CANARY-VIEWER' }], __proto__: { polluted: 'CANARY-PROTO' },
    languages: [{ name: 'עברית', level: 'x', rate: 'CANARY-RATE' }],
    expertise: [{ industry: 'i', name: 'n', description: 'd', hourlyRate: 'CANARY-RATE' }],
    employment: [{ period: 'p', position: 'pos', company: 'c', description: 'd', salary: 'CANARY-SALARY' }],
    education: [{ period: 'p', degree: 'd', institution: 'i', description: '', grade: 'CANARY-GRADE' }],
    otherSections: [{ section: 'courses', entries: ['ok'], secret: 'CANARY-SECTION' }, { section: 'reviews', entries: ['CANARY-REVIEW-SECTION'] }],
    links: [{ url: 'https://example.com', title: 't', description: '', token: 'CANARY-TOKEN' }],
  });
  const text = JSON.stringify(await json(await ask(route, payload)));
  assert.ok(text.includes('pos'), 'valid data is still there');
  assert.equal(/CANARY/.test(text), false, text.match(/CANARY[\w-]*/)?.[0]);
  const projectText = JSON.stringify(await json(await ask(setup().route, project({ phone: 'CANARY-PHONE', companyDto: { tel: 'CANARY-TEL' }, userDto: { firstName: 'CANARY-NAME' } }))));
  assert.ok(projectText.includes('בניית אתר'));
  assert.equal(/CANARY/.test(projectText), false);
});

test('caps are enforced on every field and list, markup is stripped, links are filtered', async () => {
  const long = (n) => 'a'.repeat(n);
  const payload = profile({
    headline: long(5000), slogan: long(5000), location: long(5000), about: long(5000),
    languages: Array.from({ length: 30 }, (_, i) => ({ name: `L${i}`, level: long(500) })),
    expertise: Array.from({ length: 60 }, (_, i) => ({ industry: long(200), name: `N${i}`, description: long(600) })),
    employment: Array.from({ length: 50 }, (_, i) => ({ period: long(200), position: `P${i}`, company: long(300), description: long(800) })),
    education: Array.from({ length: 30 }, (_, i) => ({ period: 'p', degree: `D${i}`, institution: long(300), description: long(800) })),
    otherSections: ['courses', 'volunteering', 'military', 'patents', 'articles', 'courses', 'bogus'].map((section) => ({ section, entries: Array.from({ length: 30 }, () => long(320)) })),
    links: [
      { url: 'javascript:alert(1)', title: 'js' }, { url: 'data:text/html,x', title: 'data' }, { url: 'ftp://example.com/x', title: 'ftp' }, { url: 'https://user:pw@example.com/', title: 'cred' },
      { url: `https://example.com/${'a'.repeat(400)}`, title: 'long' }, { url: 'https://exa mple.com/', title: 'space' }, { url: 42, title: 'num' }, { url: 'http://ok.example/a?b=1', title: '<b>Good</b>' },
      { url: 'https://example.com/1', title: 't1' }, { url: 'https://example.com/2', title: 't2' },
      ...Array.from({ length: 30 }, (_, i) => ({ url: `https://example.com/overflow/${i}`, title: `o${i}` })),
    ],
  });
  const { route } = setup();
  const response = await ask(route, payload);
  assert.equal(response.status, 200);
  const body = await json(response);
  assert.equal(body.profile.headline.length, 140);
  assert.equal(body.profile.bio.length, 1500);
  assert.deepEqual(body.counts, { expertise: 40, employment: 15, education: 10 });
  assert.equal(body.profile.skills.length, 20);
  assert.equal(body.profile.experience.split('\n').length, 15);
  assert.equal(body.profile.education.split('\n').length, 10);
  assert.ok(body.sourceText.length <= 14_000);
  assert.equal(body.warnings.length, 1, 'omitted content is reported');
  const links = body.profile.portfolio.split('\n');
  assert.equal(links.length, 3, 'the cap applies to the first 10 entries, then bad links are filtered out');
  assert.equal(links[0], 'Good: http://ok.example/a?b=1');
  for (const bad of ['javascript', 'data:', 'ftp:', 'user:pw', 'aaaa', 'exa mple']) assert.equal(body.profile.portfolio.includes(bad), false, bad);
  const many = await json(await ask(setup().route, profile({ links: Array.from({ length: 30 }, (_, i) => ({ url: `https://example.com/${i}`, title: `t${i}` })) })));
  assert.equal(many.profile.portfolio.split('\n').length, 10);
  assert.ok(body.sourceText.includes('Courses:') === false || body.sourceText.split('Courses:').length === 2, 'duplicate sections are merged away');
});

test('markup in captured strings is stripped (profile and project)', async () => {
  const body = await json(await ask(setup().route, profile({ headline: '<script>alert(1)</script>Hello <b>World</b>', about: '&lt;script&gt;x&lt;/script&gt;Plain', slogan: '{{ng.binding}}' })));
  assert.equal(body.profile.headline, 'Hello World');
  assert.equal(body.profile.bio, 'Plain');
  assert.equal(body.sourceText.includes('ng.binding'), false);
  const p = await json(await ask(setup().route, project({ title: '<img src=x onerror=alert(1)>Title', description: '<p>One</p><p>Two</p><script>bad()</script>' })));
  assert.equal(p.draft.title, 'Title');
  assert.equal(p.draft.description.includes('script'), false);
  assert.equal(p.draft.description.includes('bad()'), false);
});

test('an empty profile is NOT_ENOUGH_DATA, after the limiter', async () => {
  const { route, calls } = setup();
  const response = await ask(route, { kind: 'profile', url: PROFILE_URL, ownerSignal: true, headline: '  ', otherSections: [{ section: 'courses', entries: [''] }] });
  assert.equal(response.status, 422);
  assert.equal((await json(response)).code, 'NOT_ENOUGH_DATA');
  assert.equal(calls.limiter.length, 1);
});

test('project success: draft, publisher block for every match state, captured and owner signal', async () => {
  const cases = [
    { name: 'Acme Studio', profileDoc: { name: ' Acme Studio ' }, match: 'match', profileName: 'Acme Studio', suggested: 'Acme Studio' },
    { name: 'Totally Different', profileDoc: { name: 'Acme Studio' }, match: 'mismatch', profileName: 'Acme Studio', suggested: 'Totally Different' },
    { name: '', profileDoc: { name: 'Acme Studio' }, match: 'unknown', profileName: 'Acme Studio', suggested: 'Account Name' },
    { name: 'Acme Studio', profileDoc: undefined, match: 'no-profile', profileName: '', suggested: 'Acme Studio' },
  ];
  for (const item of cases) {
    const { route } = setup({ profileDoc: item.profileDoc });
    const response = await ask(route, project({ publisherName: item.name }));
    assert.equal(response.status, 200);
    const body = await json(response);
    assert.equal(body.publisherName, undefined);
    assert.deepEqual(body.publisher, { sourceName: item.name, match: item.match, profileName: item.profileName, suggestedName: item.suggested });
    assert.deepEqual(body.draft, { title: 'בניית אתר', description: 'תיאור מלא של הפרויקט', category: 'כללי', budget: '₪5,000', deadline: '31/12/2026', skills: ['פיתוח אתרים', 'עיצוב'] });
    assert.equal(body.url, PROJECT_URL);
    assert.equal(body.externalId, '123456');
    assert.equal(body.partial, false);
    assert.equal(body.captured, 'extension');
    assert.equal(body.ownerSignal, false);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
  }
});

test('project: flexible deadline, no budget, numeric projectId, caps, unusable text, profile read failure', async () => {
  const flexible = await json(await ask(setup().route, project({ amount: null, dueDate: null, projectId: 123456, title: 'T'.repeat(500), description: 'D'.repeat(9000), categories: Array.from({ length: 100 }, (_, i) => `c${i}`) })));
  assert.equal(flexible.draft.budget, '');
  assert.equal(flexible.draft.deadline, 'גמיש');
  assert.equal(flexible.draft.title.length, 120);
  assert.equal(flexible.draft.description.length, 5000);
  assert.equal(flexible.draft.skills.length, 20);
  for (const extra of [{ title: '' }, { description: '   ' }, { title: '{{project.title}}' }]) {
    const response = await ask(setup().route, project(extra));
    assert.equal(response.status, 422, JSON.stringify(extra));
    assert.equal((await json(response)).code, 'NOT_ENOUGH_DATA');
  }
  const failing = await ask(setup({ profileReadFails: true }).route, project());
  assert.equal(failing.status, 503);
  assert.equal((await json(failing)).error, 'לא הצלחנו לבדוק את פרופיל המפרסם. נסו שוב.');
});

test('pasted profile text: prefix, warning, empty profile fields, always needs attestation', async () => {
  const body = await json(await ask(setup().route, { kind: 'profile-text', text: 'שם\nמפתחת תוכנה עם ניסיון\n\nSkills: React' }));
  assert.ok(body.sourceText.startsWith('XPlace profile (text pasted by the user)\n'));
  assert.ok(body.sourceText.includes('מפתחת תוכנה עם ניסיון'));
  assert.deepEqual(body.profile, { name: '', headline: '', bio: '', skills: [], portfolio: '', experience: '', education: '' });
  assert.equal(body.url, '');
  assert.equal(body.ownerSignal, undefined);
  assert.deepEqual(body.warnings, ['הטקסט שהודבק נשלח ל־Vertex AI רק בלחיצה על יצירת פרופיל בעזרת AI. הוא עשוי לכלול פרטים שלא רציתם לשתף; ערכו או מחקו לפני כן.']);
});

test('pasted profile text: empty, tiny, huge, control characters, script tags, blank-line collapsing, budget', async () => {
  const run = async (text) => ask(setup().route, { kind: 'profile-text', text });
  for (const text of ['', '   \n\n  ', 'too short', '\u0000\u0001\u0002'.repeat(20), '<script>alert(1)</script>']) {
    const response = await run(text);
    assert.equal(response.status, 422, JSON.stringify(text));
    assert.equal((await json(response)).code, 'NOT_ENOUGH_DATA');
  }
  const cleaned = await json(await run('Line one\u0000 with\u0007 controls​ and <script>steal()</script>markup <b>bold</b>\n\n\n\n\n\nLine two\r\n\r\n\r\n\r\nLine three'));
  assert.equal(/[\u0000-\u0008\u000B\u000C\u000E-\u001F​]/.test(cleaned.sourceText), false);
  assert.equal(cleaned.sourceText.includes('steal'), false);
  assert.equal(cleaned.sourceText.includes('<b>'), false);
  assert.equal(/\n{3,}/.test(cleaned.sourceText), false, 'blank-line runs are collapsed');
  assert.ok(cleaned.sourceText.includes('Line one with controls and markup bold\n\nLine two\n\nLine three'));
  const huge = await json(await run(`${'שורה של טקסט בעברית. '.repeat(10) + '\n'}`.repeat(450)));
  const header = 'XPlace profile (text pasted by the user)\n';
  assert.ok(huge.sourceText.length <= 14_000);
  assert.ok(huge.sourceText.length - header.length <= 13_000);
  assert.ok(huge.sourceText.length - header.length > 12_000, 'the budget is used, not undershot');
  const wrongType = await run(12345);
  assert.equal(wrongType.status, 400);
  assert.equal((await json(wrongType)).code, 'INVALID_PAYLOAD');
});

test('one xplace_import log line per request: URL hash, never the raw URL, the pasted text or the user id', async () => {
  const original = console.info;
  const lines = [];
  console.info = (line) => lines.push(String(line));
  try {
    await ask(setup().route, profile());
    await ask(setup().route, project());
    await ask(setup().route, { kind: 'profile-text', text: 'SECRET-PASTED-TEXT '.repeat(5) });
    await ask(setup().route, profile({ headline: '', about: '', slogan: '', languages: [], expertise: [], employment: [], education: [], otherSections: [], links: [] }));
  } finally { console.info = original; }
  assert.equal(lines.length, 4);
  const entries = lines.map((line) => JSON.parse(line));
  assert.deepEqual(entries.map((e) => [e.kind, e.source, e.status]), [['profile', 'ingest', 'success'], ['project', 'ingest', 'success'], ['profile-text', 'ingest', 'success'], ['profile', 'ingest', 'NOT_ENOUGH_DATA']]);
  for (const [index, line] of lines.entries()) {
    assert.match(entries[index].urlSha256, /^[0-9a-f]{64}$/);
    for (const secret of ['xplace.com', 'some-freelancer', '123456', user.uid, 'person@example.com', 'SECRET-PASTED-TEXT']) assert.equal(line.includes(secret), false, secret);
  }
  assert.equal(entries[0].urlSha256, createHash('sha256').update(PROFILE_URL).digest('hex'));
});

test('the project link route and the ingest route share one pipeline module', async () => {
  const { readFileSync } = await import('node:fs');
  for (const route of ['ingest', 'project']) {
    const source = readFileSync(new URL(`../src/app/api/integrations/xplace/${route}/route.ts`, import.meta.url), 'utf8');
    assert.match(source, /handleImportRoute/, route);
    assert.doesNotMatch(source, /getCurrentUser|enforceActionLimit|readJsonBody/, `${route} must not repeat pipeline steps`);
  }
});

test('the link path and the ingest path produce the same draft from the same project (one normalizeProject)', () => {
  const projectModule = loadModule('src/lib/imports/xplace/project.ts');
  const record = { projectId: 123456, title: 'בניית אתר', description: 'תיאור מלא של הפרויקט', amount: 5000, projectDueDate: '2026-12-31T00:00:00', projectCategories: [{ nameHe: 'פיתוח אתרים, עיצוב' }, { nameHe: 'עיצוב' }], companyDto: { companyNameHe: 'Acme Studio' } };
  const html = `<html><script>self.__next_f.push([1,${JSON.stringify(`x:{"project":${JSON.stringify(record)}}`)}])</script></html>`;
  const target = { kind: 'project', projectId: '123456', canonicalUrl: PROJECT_URL, fetchUrl: 'https://www.xplace.com/project?id=123456' };
  const viaLink = projectModule.parseXPlaceProjectHtml(html, target);
  const ingest = loadModule('src/lib/imports/xplace/ingest.ts', { stubs: { '@/lib/imports/errors': errorsModule } });
  const viaIngest = ingest.buildProjectImport(ingest.validateIngestPayload(project()));
  assert.deepEqual({ ...viaLink.draft, skills: [...viaLink.draft.skills] }, { ...viaIngest.draft, skills: [...viaIngest.draft.skills] });
  assert.equal(viaLink.publisherName, viaIngest.publisherName);
});
