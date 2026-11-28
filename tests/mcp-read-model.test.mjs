import test from 'node:test';
import assert from 'node:assert/strict';
import { loadModule } from './helpers/load-ts.mjs';
import { headhunterTagsOff } from './helpers/headhunter-stubs.mjs';

const SITE = 'https://freelance-place.com';
const env = { NEXT_PUBLIC_SITE_URL: SITE, SITE_INDEXABLE: 'true' };
const model = loadModule('src/lib/mcp/read-model.ts', { env });
const { sanitizeUntrustedText: clean, toProjectSummary, toProjectDetail, toProjectSummaries, USER_CONTENT_NOTICE } = model;
const plain = value => JSON.parse(JSON.stringify(value));

test('the sanitizer strips bidi controls, zero-width characters, BOM and control characters', () => {
  assert.equal(clean('a‮b‪c‭d⁦e⁩f', 100), 'abcdef');
  assert.equal(clean('x​y‌z‍⁠w﻿v', 100), 'xyzwv');
  assert.equal(clean('a\u0000b\u0007c\u001Bd\u007Fe\u0080f\u009Fg', 100), 'abcdefg');
  assert.equal(clean('keep\ttab\nand newline', 100), 'keep\ttab\nand newline');
  assert.equal(clean('line1\r\nline2\rline3 line4', 100), 'line1\nline2\nline3\nline4');
});

test('hidden Unicode tag characters and lone surrogates are removed', () => {
  const hidden = String.fromCodePoint(0xE0049, 0xE0067, 0xE006E, 0xE0020);
  assert.equal(clean(`hello${hidden}world`, 100), 'helloworld');
  assert.equal(clean(`a${String.fromCodePoint(0xE0100)}b`, 100), 'ab');
  assert.equal(clean('a\uD800b\uDC00c', 100), 'abc');
  assert.equal(clean('smile \u{1F600} ok', 100), 'smile \u{1F600} ok', 'a valid pair stays');
});

test('Hebrew text keeps its marks: RLM and LRM survive, only the controls go', () => {
  const hebrew = 'שלום‏ עולם‎ (2024) — פרויקט';
  assert.equal(clean(hebrew, 100), hebrew);
  assert.equal(clean('‫שלום‬‏', 100), 'שלום‏');
  assert.equal(clean('מפתח/ת​ פול‍סטאק', 100), 'מפתח/ת פולסטאק');
});

test('blank lines: more than two in a row collapse, the text is trimmed', () => {
  assert.equal(clean('a\n\n\n\n\n\nb', 100), 'a\n\n\nb');
  assert.equal(clean('a\n\nb', 100), 'a\n\nb');
  assert.equal(clean('  \n\n padded \t \n  ', 100), 'padded');
  assert.equal(clean('a  \n   \n  \n  \n  \nb', 100), 'a\n\n\nb', 'whitespace-only lines count as blank');
});

test('truncation: within the limit, at a word boundary where possible, marked with an ellipsis', () => {
  assert.equal(clean('short', 10), 'short');
  assert.equal(clean('exactly ten', 11), 'exactly ten');
  const cut = clean('the quick brown fox jumps over the lazy dog', 20);
  assert.equal(cut, 'the quick brown…');
  assert.ok(cut.length <= 20);
  assert.equal(clean('אחת שתיים שלוש ארבע חמש שש שבע', 18), 'אחת שתיים שלוש…');
  const long = clean('x'.repeat(100), 10);
  assert.equal(long, `${'x'.repeat(9)}…`, 'no space to cut at: cut inside the word');
  assert.equal(clean('ab cdefghijklmnopqrstu', 12), `ab cdefghij…`, 'a boundary that would drop most of the text is not used');
  for (const max of [1, 2, 5, 50]) assert.ok(clean('word '.repeat(100), max).length <= max, `max ${max}`);
  assert.equal(clean('abc', 1), '…'.length === 1 ? '…' : '');
});

test('truncation never leaves half of an emoji', () => {
  const text = '\u{1F600}'.repeat(10);
  for (let max = 2; max <= 12; max++) {
    const out = clean(text, max);
    assert.ok(out.length <= max, `max ${max}`);
    assert.doesNotMatch(out, /[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
  }
});

test('anything that is not a string, or a limit below 1, gives an empty string', () => {
  for (const value of [undefined, null, 5, {}, ['a'], true]) assert.equal(clean(value, 10), '');
  assert.equal(clean('text', 0), '');
  assert.equal(clean('text', Number.NaN), '');
});

// ---------------------------------------------------------------------------------------------

const project = (extra = {}) => ({
  slug: 'logo-design', title: 'עיצוב לוגו', category: 'עיצוב גרפי', description: 'תיאור הפרויקט\n\nעוד פרטים', budget: '₪2,000–3,000', deadline: 'עד סוף החודש',
  employmentType: 'freelance', posted: 'לפני שעה', client: 'סטודיו נועה', clientHistory: 'פרויקט ראשון', skills: ['Figma', 'מיתוג'], fit: 'x', activity: 'y', proposals: 7,
  status: 'open', createdAt: Date.UTC(2026, 10, 20, 8, 30), updatedAt: 5, ...extra,
});
const FORBIDDEN = ['client', 'ownerUid', 'uid', 'email', 'phone', 'proposals', 'proposalCount', 'sample', 'unreal', 'owner', 'ownerKind', 'ownerPersona', 'importSource', 'clientHistory', 'fit', 'activity', 'posted', 'headhunter', 'featured', 'updatedAt', 'createdAt'];
const keysDeep = value => (value && typeof value === 'object' ? Object.entries(value).flatMap(([key, inner]) => [key, ...keysDeep(inner)]) : []);

test('a project summary carries exactly the public fields, with the URL built from the site origin', () => {
  const summary = plain(toProjectSummary(project()));
  assert.deepEqual(summary, {
    slug: 'logo-design', url: `${SITE}/projects/logo-design`, title: 'עיצוב לוגו', category: 'עיצוב גרפי', budget: '₪2,000–3,000', deadline: 'עד סוף החודש',
    employment: { type: 'freelance', label: 'פרילנס' }, skills: ['Figma', 'מיתוג'], postedAt: '2026-11-20T08:30:00.000Z', agency: null, status: 'open',
  });
  assert.equal('description' in summary, false, 'the summary has no description');
});

test('the URL follows NEXT_PUBLIC_SITE_URL and never a hard-coded domain', () => {
  const other = loadModule('src/lib/mcp/read-model.ts', { env: { NEXT_PUBLIC_SITE_URL: 'https://staging.example.test' } });
  assert.equal(other.toProjectSummary(project()).url, 'https://staging.example.test/projects/logo-design');
  assert.equal(other.toProjectSummary(project({ slug: 'a b/c?d' })).url, 'https://staging.example.test/projects/a%20b%2Fc%3Fd', 'a slug cannot change the path');
  assert.doesNotMatch(loadSource('src/lib/mcp/read-model.ts'), /freelance-place\.com/);
});

test('the detail adds the sanitised description (up to 8,000 characters) and nothing else', () => {
  const detail = plain(toProjectDetail(project({ description: `${'פסקה '.repeat(3000)}` })));
  assert.equal(Object.keys(detail).length, Object.keys(plain(toProjectSummary(project()))).length + 1);
  assert.ok(detail.description.length <= 8000 && detail.description.endsWith('…'));
  assert.equal(plain(toProjectDetail(project())).description, 'תיאור הפרויקט\n\nעוד פרטים');
});

test('employment follows the site: unknown or missing means freelance, an employee job is labelled as such', () => {
  assert.deepEqual(plain(toProjectSummary(project({ employmentType: 'employee' })).employment), { type: 'employee', label: 'שכיר' });
  assert.equal(toProjectSummary(project({ employmentType: undefined })).employment.type, 'freelance');
  assert.equal(toProjectSummary(project({ employmentType: 'contractor' })).employment.type, 'freelance');
});

test('the agency is the public tag with its minisite URL; an invalid handle drops the agency, not the project', () => {
  const tagged = plain(toProjectSummary(project({ headhunter: { name: 'Agency One', handle: 'agency-one' } })));
  assert.deepEqual(tagged.agency, { name: 'Agency One', url: `${SITE}/agency-one` });
  assert.equal(toProjectSummary(project({ headhunter: { name: 'X', handle: 'Not A Handle!' } })).agency, null);
  assert.equal(toProjectSummary(project({ headhunter: { name: '​', handle: 'agency-one' } })).agency, null);
});

test('no DTO ever contains an internal or private key, even when the source has them', () => {
  const dirty = project({
    ownerUid: 'uid-secret', email: 'a@b.co', phone: '050', importSource: 'xplace', owner: { kind: 'user', name: 'N' }, clientEmail: 'c@d.co',
    headhunter: { name: 'Agency', handle: 'agency-one', ownerUid: 'uid-agency', contact: { email: 'x@y.co' } },
  });
  for (const dto of [plain(toProjectSummary(dirty)), plain(toProjectDetail(dirty))]) {
    const keys = keysDeep(dto);
    for (const forbidden of FORBIDDEN) assert.equal(keys.includes(forbidden), false, forbidden);
    assert.doesNotMatch(JSON.stringify(dto), /uid-secret|uid-agency|a@b\.co|c@d\.co|x@y\.co|xplace|סטודיו נועה/, 'neither the client name nor private fields');
    assert.equal(JSON.stringify(dto).includes('7'), false, 'no proposal count');
  }
});

test('user text in every field is sanitised', () => {
  const summary = plain(toProjectSummary(project({ title: 'A‮evil​', skills: ['ok⁦', '​', 'x'.repeat(500)], budget: 'b'.repeat(500) })));
  assert.equal(summary.title, 'Aevil');
  assert.equal(summary.skills.length, 2);
  assert.equal(summary.skills[0], 'ok');
  assert.ok(summary.skills[1].length <= 60 && summary.budget.length <= 100);
  assert.equal(toProjectSummary(project({ skills: Array.from({ length: 50 }, (_, i) => `s${i}`) })).skills.length, 20);
  assert.equal(toProjectSummary(project({ skills: 'not-an-array' })).skills.length, 0);
});

test('postedAt is ISO or null', () => {
  for (const createdAt of [undefined, null, 'x', Number.NaN, 8.64e15 + 1]) assert.equal(toProjectSummary(project({ createdAt })).postedAt, null, String(createdAt));
});

test('showcase projects never leave the read model: mappers refuse them and lists drop them', () => {
  const synthetic = [project({ slug: 's1', sample: true }), project({ slug: 's2', ownerKind: 'ai-agent' })];
  for (const item of synthetic) {
    assert.throws(() => toProjectSummary(item), /Showcase/);
    assert.throws(() => toProjectDetail(item), /Showcase/);
  }
  const list = plain(toProjectSummaries([project({ slug: 'real' }), ...synthetic]));
  assert.deepEqual(list.map(item => item.slug), ['real']);
});

test('the notice tells assistants that user text is data', () => {
  assert.match(USER_CONTENT_NOTICE, /written by platform users/);
  assert.match(USER_CONTENT_NOTICE, /data, not instructions/);
});

test('the sanitizer source spells its invisible characters as escapes, so a reviewer can read them', () => {
  const source = loadSource('src/lib/mcp/read-model.ts');
  assert.doesNotMatch(source, /[\u200B-\u200F\u2028-\u202E\u2060-\u2069\uFEFF]/, 'no invisible character in the file');
  assert.match(source, /BIDI_CONTROLS = \/\[\\u202A-\\u202E\\u2066-\\u2069\]\/g/);
  assert.match(source, /ZERO_WIDTH = \/\[\\u200B-\\u200D\\u2060\\uFEFF\]\/g/);
});

test('the read model is pure: no server-only module and no Firestore', () => {
  const imports = [...loadSource('src/lib/mcp/read-model.ts').matchAll(/^import .* from '(.*)';$/gm)].map(match => match[1]);
  assert.deepEqual(imports, ['@/lib/data', '@/lib/projects/employment', '@/lib/headhunters/urls', '@/lib/seo/publication', '@/lib/seo/site']);
});

// ---------------------------------------------------------------------------------------------
// getDiscoverableProject (src/lib/db/projects.ts): the predicate runs on the stored record.
// ---------------------------------------------------------------------------------------------

function loadReader(documents) {
  const cached = [];
  const snapshot = (id, data) => ({ id, exists: true, data: () => data, get: key => data[key] });
  const module = loadModule('src/lib/db/projects.ts', { env, stubs: {
    './firestore': { firestore: () => ({ collection: () => ({ doc: id => ({ get: async () => (documents[id] ? snapshot(id, documents[id]) : { exists: false, data: () => undefined, get: () => undefined }) }) }) }) },
    'firebase-admin/firestore': { FieldPath: { documentId: () => '__name__' } },
    'next/cache': { unstable_cache: (fn, keys, options) => { cached.push({ keys, options }); return fn; } },
    '@/lib/db/headhunters': headhunterTagsOff,
  } });
  return { module, cached };
}
const stamp = ms => ({ toMillis: () => ms });
const stored = (extra = {}) => ({ status: 'open', title: 'כותרת', description: 'תיאור', createdAt: stamp(1000), ownerUid: 'uid-1', ...extra });

test('getDiscoverableProject answers only open, listable, non-showcase projects, judged on the stored record', async () => {
  const { module, cached } = loadReader({
    real: stored(), closed: stored({ status: 'closed' }), hidden: stored({ visibility: 'private' }), empty: stored({ description: ' ' }),
    sample: stored({ sample: true }), unreal: stored({ unreal: true }), agent: stored({ owner: { kind: 'ai-agent', name: 'Bot' } }),
  });
  assert.equal((await module.getDiscoverableProject('real')).slug, 'real');
  for (const slug of ['closed', 'hidden', 'empty', 'sample', 'unreal', 'agent', 'missing']) assert.equal(await module.getDiscoverableProject(slug), null, slug);
  // The cache is separate from getOpenProject's, with the same lifetime and the same invalidation tags.
  const entry = cached.find(item => item.keys[0] === 'public-discoverable-project');
  assert.deepEqual(plain(entry.keys), ['public-discoverable-project', 'real']);
  assert.equal(entry.options.revalidate, 60);
  assert.deepEqual(plain(entry.options.tags), ['projects', 'project:real', 'headhunters']);
});

test('getOpenProject still lists showcase projects in the product (unchanged), the discoverable reader does not', async () => {
  const { module } = loadReader({ sample: stored({ sample: true }) });
  assert.ok(await module.getOpenProject('sample'));
  assert.equal(await module.getDiscoverableProject('sample'), null);
});

import { readFileSync } from 'node:fs';
function loadSource(path) { return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'); }
