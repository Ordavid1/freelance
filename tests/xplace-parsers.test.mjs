import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadModule } from './helpers/load-ts.mjs';

const fixture = (name) => readFileSync(new URL(`./fixtures/xplace/${name}`, import.meta.url), 'utf8');
// Modules run in a vm realm; a JSON round trip gives plain host-realm objects for deepEqual.
const plain = (value) => JSON.parse(JSON.stringify(value));
const projectModule = loadModule('src/lib/imports/xplace/project.ts');
const parseXPlaceProjectHtml = (...args) => plain(projectModule.parseXPlaceProjectHtml(...args));
const { cleanText } = loadModule('src/lib/imports/xplace/clean.ts');

const project = { kind: 'project', projectId: '123456', canonicalUrl: 'https://www.xplace.com/il/job-bids/123456', fetchUrl: 'https://www.xplace.com/project?id=123456' };
const CANARIES = ['CANARYFIRST', 'CANARYLAST', '000-0000', 'canary-logo', 'canary-photo', 'CANARY MEMBER NAME', '2027-01-07', '07/01/2027', 'lastLogin'];

function assertNoCanaries(output) {
  const text = JSON.stringify(output);
  for (const canary of CANARIES) assert.ok(!text.includes(canary), `leaked ${canary}`);
  assert.ok(!/\+?\d[\d\s-]{8,}\d/.test(text.replace(/₪[\d,]+/g, '')), 'phone-like digits');
}

test('project: flight payload maps every field and never leaks personal data', () => {
  const result = parseXPlaceProjectHtml(fixture('project-rsc.html'), project);
  assert.equal(result.provider, 'xplace');
  assert.equal(result.url, project.canonicalUrl);
  assert.equal(result.externalId, '123456');
  assert.equal(result.partial, false);
  assert.deepEqual(result.warnings, []);
  assert.equal(result.draft.title, 'Need a WordPress developer');
  assert.equal(result.draft.category, 'כללי');
  assert.equal(result.draft.budget, '₪5,000');
  assert.equal(result.draft.deadline, 'גמיש');
  assert.deepEqual(result.draft.skills, ['Microsoft', 'MCITP', 'MCSE', 'וורדפרס']);
  assert.equal(result.publisherName, 'Osys | אוסיס פתרונות תוכנה');
  assert.deepEqual(Object.keys(result).sort(), ['draft', 'externalId', 'partial', 'provider', 'publisherName', 'url', 'warnings']);
  assertNoCanaries(result);
});

test('project: description keeps paragraphs and strips markup, scripts and encoded tags', () => {
  const { draft } = parseXPlaceProjectHtml(fixture('project-rsc.html'), project);
  assert.equal(draft.description, 'Line one with bold text & more.\n\nLine two: ok.\n\nLine three.');
  for (const bad of ['<', '>', 'alert', 'steal', 'onerror']) {
    assert.ok(!draft.description.includes(bad) && !draft.title.includes(bad), bad);
  }
});

test('project: budget and deadline rules', () => {
  const html = (patch) => {
    const object = { projectId: 123456, title: 'T', description: 'D', ...patch };
    return `<script>self.__next_f.push([1,${JSON.stringify(`1:{"project":${JSON.stringify(object)}}`)}])</script>`;
  };
  const run = (patch) => parseXPlaceProjectHtml(html(patch), project).draft;
  assert.equal(run({ amount: 1234567 }).budget, '₪1,234,567');
  assert.equal(run({ amount: 0 }).budget, '');
  assert.equal(run({ amount: null }).budget, '');
  assert.equal(run({ amount: -5 }).budget, '');
  assert.equal(run({}).budget, '');
  assert.equal(run({ projectDueDate: '2026-12-01T00:00:00' }).deadline, '01/12/2026');
  assert.equal(run({ projectDueDate: null, expirationDate: '2027-01-07T23:58:00' }).deadline, 'גמיש');
  assert.equal(run({ expirationDate: '2027-01-07T23:58:00' }).deadline, 'גמיש');
  assert.equal(run({ projectDueDate: '2026-13-45T00:00:00' }).deadline, 'גמיש');
  assert.equal(run({ projectDueDate: 'garbage' }).deadline, 'גמיש');
});

test('project: skills are split, trimmed, de-duplicated and capped', () => {
  const categories = [{ nameHe: ' A , B,, a ' }, { nameHe: '', nameEn: 'C, ' + 'x'.repeat(100) }, ...Array.from({ length: 40 }, (_, i) => ({ nameHe: `skill${i}` }))];
  const object = { projectId: 123456, title: 'T', description: 'D', projectCategories: categories };
  const html = `<script>self.__next_f.push([1,${JSON.stringify(`"project":${JSON.stringify(object)}`)}])</script>`;
  const { skills } = parseXPlaceProjectHtml(html, project).draft;
  assert.deepEqual(skills.slice(0, 3), ['A', 'B', 'C']);
  assert.equal(skills.length, 20);
  assert.ok(skills.every((skill) => skill.length <= 60));
  assert.equal(new Set(skills.map((skill) => skill.toLowerCase())).size, skills.length);
});

test('project: publisher falls back to the English name, then to empty', () => {
  const build = (company) => `<script>self.__next_f.push([1,${JSON.stringify(`"project":${JSON.stringify({ projectId: 123456, title: 'T', description: 'D', companyDto: company })}`)}])</script>`;
  assert.equal(parseXPlaceProjectHtml(build({ companyNameHe: '', companyNameEn: 'Acme Ltd' }), project).publisherName, 'Acme Ltd');
  assert.equal(parseXPlaceProjectHtml(build({ companyNameHe: '', companyNameEn: '' }), project).publisherName, '');
  assert.equal(parseXPlaceProjectHtml(build(undefined), project).publisherName, '');
});

test('project: title and description are length capped', () => {
  const object = { projectId: 123456, title: 'ת'.repeat(500), description: 'd'.repeat(9000) };
  const html = `<script>self.__next_f.push([1,${JSON.stringify(`"project":${JSON.stringify(object)}`)}])</script>`;
  const { draft } = parseXPlaceProjectHtml(html, project);
  assert.equal(draft.title.length, 120);
  assert.equal(draft.description.length, 5000);
});

test('project: label-driven HTML layer when there is no JSON', () => {
  const result = parseXPlaceProjectHtml(fixture('project-html-only.html'), project);
  assert.equal(result.partial, false);
  assert.equal(result.draft.title, 'Need a WordPress developer');
  assert.equal(result.draft.description, 'First paragraph here.\n\nSecond paragraph & more.');
  assert.deepEqual(result.draft.skills, ['Microsoft', 'MCITP', 'MCSE', 'WordPress']);
  assert.equal(result.draft.budget, '₪5,000');
  assert.equal(result.draft.deadline, 'גמיש');
  assert.equal(result.publisherName, '');
  assert.ok(!JSON.stringify(result).includes('07/01'), 'expiry date must not be used');
});

test('project: HTML layer reads a displayed due date and normalises two-digit years', () => {
  const html = fixture('project-html-only.html').replace('<b>תאריך היעד</b><br/>גמיש', '<b>תאריך היעד</b><br/>15/03/27');
  assert.equal(parseXPlaceProjectHtml(html, project).draft.deadline, '15/03/2027');
  const fourDigits = fixture('project-html-only.html').replace('<b>תאריך היעד</b><br/>גמיש', '<b>תאריך היעד</b><br/>15/03/2027');
  assert.equal(parseXPlaceProjectHtml(fourDigits, project).draft.deadline, '15/03/2027');
  const threeDigits = fixture('project-html-only.html').replace('<b>תאריך היעד</b><br/>גמיש', '<b>תאריך היעד</b><br/>15/03/202');
  assert.equal(parseXPlaceProjectHtml(threeDigits, project).draft.deadline, 'גמיש');
});

test('project: meta-only page is a partial draft with a warning', () => {
  const result = parseXPlaceProjectHtml(fixture('project-meta-only.html'), project);
  assert.equal(result.partial, true);
  assert.deepEqual(result.warnings, ['חלק מפרטי הפרויקט לא היו זמינים. בדקו את התיאור לפני הפרסום.']);
  assert.equal(result.draft.title, 'Need a WordPress developer');
  assert.equal(result.draft.description, 'Meta description only, truncated…');
  assert.equal(result.draft.budget, '');
  assert.equal(result.draft.deadline, 'גמיש');
});

test('project: malformed or truncated flight JSON falls back to the HTML layer', () => {
  const original = fixture('project-rsc.html');
  // Truncated: cut the last flight chunk in the middle of the project object.
  const truncated = original.replace(/"description\\":/, '"descr').replace(/\\"userDto\\"[\s\S]*<\/script><\/body>/, '</script></body>');
  const withHtml = (html) => html.replace('<div id="app">Loading</div>', fixture('project-html-only.html').match(/<body>([\s\S]*)<\/body>/)[1]);
  const result = parseXPlaceProjectHtml(withHtml(truncated), project);
  assert.equal(result.draft.description, 'First paragraph here.\n\nSecond paragraph & more.');
  const broken = original.replace('"projectId\\":123456', '"projectId\\":123456,,');
  assert.equal(parseXPlaceProjectHtml(withHtml(broken), project).draft.skills.includes('WordPress'), true);
  // No HTML layer at all: meta layer, partial.
  assert.equal(parseXPlaceProjectHtml(broken, project).partial, true);
});

test('project: id mismatch makes the JSON unusable', () => {
  const other = { ...project, projectId: '999999' };
  assert.throws(() => parseXPlaceProjectHtml(fixture('project-rsc.html').replace(/<title>[\s\S]*?<\/head>/, '</head>'), other), { code: 'NOT_ENOUGH_DATA' });
  // The og:url of a page for another project also disqualifies the HTML and meta layers.
  assert.throws(() => parseXPlaceProjectHtml(fixture('project-meta-only.html'), other), { code: 'NOT_ENOUGH_DATA' });
  assert.throws(() => parseXPlaceProjectHtml(fixture('project-html-only.html'), other), { code: 'NOT_ENOUGH_DATA' });
});

test('project: empty or unusable pages are NOT_ENOUGH_DATA', () => {
  assert.throws(() => parseXPlaceProjectHtml(fixture('project-empty.html'), project), { code: 'NOT_ENOUGH_DATA' });
  assert.throws(() => parseXPlaceProjectHtml('', project), { code: 'NOT_ENOUGH_DATA' });
  const template = '<h1>{{title}}</h1><h3>פרטי הפרויקט</h3><p>{{description}}</p>';
  assert.throws(() => parseXPlaceProjectHtml(template, project), { code: 'NOT_ENOUGH_DATA' });
});

test('cleanText: entities, tags, control characters and whitespace', () => {
  assert.equal(cleanText('a&nbsp;&nbsp;b &#65;&#x42; &lt;i&gt;x&lt;/i&gt;\u0000‏  c', 100), 'a b AB x c');
  assert.equal(cleanText('x <a href="javascript:alert(1)">link</a><!-- c -->', 100), 'x link');
  assert.equal(cleanText('1 < 2 and 3 > 2', 100), '1 < 2 and 3 > 2');
  assert.equal(cleanText('a<br/>b</p><p>c', 100, { paragraphs: true }), 'a\nb\n\nc');
  assert.equal(cleanText(42, 10), '');
  assert.equal(cleanText('abcdef', 3), 'abc');
});
