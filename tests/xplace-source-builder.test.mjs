import test from 'node:test';
import assert from 'node:assert/strict';
import { loadModule } from './helpers/load-ts.mjs';

const { fitSections, buildProfileSourceText, profileSections, SOURCE_TEXT_MAX } = loadModule('src/lib/imports/xplace/source-builder.ts');

const facts = (extra = {}) => ({
  url: 'https://www.xplace.com/il/u/some-freelancer', headline: 'מפתחת Full Stack', slogan: '', location: 'חיפה, ישראל', about: 'אני בונה מוצרים. I build products.',
  languages: [{ name: 'עברית', level: 'שפת אם' }, { name: 'English', level: 'Fluent' }],
  expertise: [{ industry: 'פיתוח', name: 'React, Node.js', description: 'בניית ממשקים' }],
  employment: [{ period: '2020 - היום', position: 'מפתחת בכירה', company: 'Acme', description: 'ניהול צוות' }],
  education: [{ period: '2015 - 2018', degree: 'B.Sc', institution: 'הטכניון', description: '' }],
  otherSections: [{ section: 'Courses', entries: ['Kubernetes basics'] }],
  links: [{ url: 'https://example.com/me', title: 'Portfolio', description: '' }],
  ...extra,
});
const big = (n, label) => Array.from({ length: n }, (_, i) => `${label} ${i} ${'x'.repeat(280)}`);

test('the budget is a hard ceiling for any input and any budget', () => {
  const huge = facts({
    about: 'a'.repeat(100_000),
    employment: Array.from({ length: 200 }, (_, i) => ({ period: 'p', position: `pos ${i}`, company: 'c', description: 'd'.repeat(5000) })),
    expertise: Array.from({ length: 300 }, (_, i) => ({ industry: 'i', name: `n${i}`, description: 'e'.repeat(2000) })),
    otherSections: [{ section: 'Courses', entries: big(500, 'course') }],
  });
  for (const budget of [0, 1, 10, 80, 1000, SOURCE_TEXT_MAX]) {
    const { text } = buildProfileSourceText(huge, budget);
    assert.ok(text.length <= budget, `budget ${budget} got ${text.length}`);
  }
  const { text, omitted } = buildProfileSourceText(huge);
  assert.ok(text.length <= 14_000);
  assert.equal(SOURCE_TEXT_MAX, 14_000);
  assert.equal(omitted, true);
});

test('everything fits in order of priority and nothing is marked omitted for a normal profile', () => {
  const { text, omitted } = buildProfileSourceText(facts());
  assert.equal(omitted, false);
  const order = ['XPlace profile', 'Profile URL:', 'Headline:', 'Location:', 'About:', 'Employment:', 'Education:', 'Expertise:', 'Expertise details:', 'Languages:', 'Links:', 'Courses:'];
  const positions = order.map((label) => text.indexOf(label));
  assert.ok(positions.every((p) => p >= 0), JSON.stringify(positions));
  assert.deepEqual([...positions].sort((a, b) => a - b), positions);
});

test('Hebrew and Latin text survive unchanged', () => {
  const { text } = buildProfileSourceText(facts());
  for (const piece of ['מפתחת Full Stack', 'I build products.', '2020 - היום · מפתחת בכירה, Acme', 'פיתוח: React, Node.js', 'עברית (שפת אם)', 'English (Fluent)', 'Portfolio · https://example.com/me']) assert.ok(text.includes(piece), piece);
});

test('when the budget runs out, higher-priority sections win and lower ones are dropped', () => {
  const f = facts({ employment: Array.from({ length: 20 }, (_, i) => ({ period: '', position: `Role ${i}`, company: 'Co', description: 'd'.repeat(600) })) });
  const { text, omitted } = buildProfileSourceText(f, 4000);
  assert.ok(text.length <= 4000);
  assert.equal(omitted, true);
  assert.ok(text.includes('About:') && text.includes('Employment:') && text.includes('Role 0'));
  assert.equal(text.includes('Role 19'), false);
  assert.equal(text.includes('Courses:'), false);
});

test('expertise descriptions only appear while budget remains; names and industries come first', () => {
  const f = facts({ about: '', employment: [], education: [], expertise: Array.from({ length: 20 }, (_, i) => ({ industry: `Ind${i}`, name: `Skill${i}`, description: 'z'.repeat(250) })), languages: [], links: [], otherSections: [] });
  const names = buildProfileSourceText(f, 14_000).text;
  assert.ok(names.includes('Expertise details:'));
  const tight = buildProfileSourceText(f, 700);
  assert.ok(tight.text.includes('Ind19: Skill19'), 'every name line is kept');
  assert.equal(tight.text.includes('Expertise details:'), false);
  assert.equal(tight.omitted, true);
});

test('empty lists produce no headings, and empty header fields no lines', () => {
  const { text } = buildProfileSourceText(facts({ headline: '', location: '', about: '', languages: [], expertise: [], employment: [], education: [], otherSections: [], links: [] }));
  assert.equal(text, 'XPlace profile (captured from the owner\'s own page)\nProfile URL: https://www.xplace.com/il/u/some-freelancer');
  for (const heading of ['Employment:', 'Education:', 'Expertise:', 'Languages:', 'Links:']) assert.equal(text.includes(heading), false);
});

test('fitSections: a heading is only emitted together with its first line, a tiny budget truncates the first block, no half surrogate pair', () => {
  assert.equal(fitSections([{ heading: 'H:', lines: ['x'.repeat(50)] }], 10).text, 'x'.repeat(10));
  assert.equal(fitSections([{ lines: ['a'] }, { heading: 'H:', lines: ['y'.repeat(50)] }], 10).text, 'a');
  const emoji = '😀'.repeat(10);
  const cut = fitSections([{ lines: [emoji] }], 5).text;
  assert.equal(cut, '😀😀');
  assert.deepEqual({ ...fitSections([], 100) }, { text: '', omitted: false });
});

test('profileSections keeps the documented priority order', () => {
  const labels = profileSections(facts()).map((s) => s.heading || 'header');
  assert.deepEqual([...labels], ['header', 'Employment:', 'Education:', 'Expertise:', 'Expertise details:', 'Languages:', 'Links:', 'Courses:']);
});
