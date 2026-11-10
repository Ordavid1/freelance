import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadModule, projectRoot } from './helpers/load-ts.mjs';

const { SITE_URL } = loadModule('src/lib/seo/site.ts');
const base = { SITE_INDEXABLE: 'true', NEXT_PUBLIC_SITE_URL: SITE_URL };
const billingOn = { ...base, BILLING_ENABLED: 'true', CARDCOM_TERMINAL_NUMBER: '1', CARDCOM_API_NAME: 'x' };
const billingOff = { ...base };
const SECTION_ORDER = ['Product', 'Guides', 'Categories', 'Skills', 'Comparisons', 'Legal'];

const llmsFor = (env = billingOn, stubs = {}) => loadModule('src/lib/seo/llms.ts', { env, stubs });
const factsFor = (env) => loadModule('src/lib/seo/facts.ts', { env });
const { skillCompleteness } = loadModule('src/lib/seo/skills.ts');

// Synthetic editorial data, so sections that are empty today are exercised too.
const longText = Array.from({ length: 100 }, (_, index) => `מילה${index}`).join(' ');
const skill = (slug, over = {}) => ({
  slug, name: `כישור ${slug}`, aliases: [], category: 'design', title: `כישור בדיקה ארוך מספיק ${slug}`, description: 'ת'.repeat(80),
  definition: `הגדרה ייחודית של ${slug}. ${longText}`, whenNeeded: longText,
  deliverables: [`תוצר ראשון ${slug}`, 'תוצר שני', 'תוצר שלישי', 'תוצר רביעי'], howToChoose: ['א', 'ב', 'ג', 'ד'], priceDrivers: ['א', 'ב', 'ג'],
  questions: [{ question: `שאלה ראשונה על ${slug}?`, answer: `תשובה ראשונה על ${slug}. ${longText}` }, { question: 'שאלה שנייה?', answer: 'תשובה שנייה.' }, { question: 'שאלה שלישית?', answer: 'תשובה שלישית.' }],
  related: [], published: '2026-11-01', modified: '2026-11-02', ...over,
});
const guide = (slug) => ({
  slug, title: `מדריך בדיקה ארוך מספיק ${slug}`, description: 'ת'.repeat(80), audience: 'both', published: '2026-11-01', modified: '2026-11-03',
  summary: `בקיצור של ${slug}: תשובה ישירה.`, related: [], disclaimer: `הבהרה של ${slug}.`,
  sections: ['one', 'two', 'three', 'four'].map((id) => ({ id, heading: `כותרת ${id} ${slug}`, answer: `תשובה ${id} ${slug}.`, paragraphs: [`פסקה ארוכה ${id} ${slug} שנשארת בדף`], list: { items: [`פריט ${id}`] } })),
  faq: [{ question: 'שאלה?', answer: 'תשובה.' }],
});
const page = (path, over = {}) => ({ path, kind: 'info', title: `עמוד בדיקה ארוך מספיק ${path.slice(1)}`, description: 'ת'.repeat(80), ...over });
const infoContent = {
  pricingContent: () => ({ h1: 'מחירים בדיקה', summary: 'בקיצור מחירים.', sections: [{ id: 'free', heading: 'מה חינם?', answer: 'פרסום חינם.', paragraphs: ['פסקת מחיר ארוכה'] }], faq: [{ question: 'כמה זה עולה?', answer: 'תשובת מחיר.' }], related: [], disclaimer: 'הבהרת מחיר.' }),
  aboutContent: () => ({ h1: 'אודות בדיקה', summary: 'בקיצור אודות.', sections: [{ id: 'who', heading: 'מי מפעיל?', answer: 'המפעיל.' }], faq: [], related: [] }),
  howItWorksContent: () => ({ h1: 'איך זה עובד בדיקה', summary: 'בקיצור איך.', sections: [], faq: [], related: [] }),
  faqContent: () => ({ h1: 'שאלות נפוצות בדיקה', summary: 'בקיצור שאלות.', groups: [{ id: 'g1', heading: 'קבוצה ראשונה', items: [{ question: 'שאלה בקבוצה?', answer: 'תשובה בקבוצה.' }] }], related: [] }),
};
function stubsFor({ skills = [], guides = [], hubs = [], infos = [] } = {}) {
  return {
    './skills': { skills, skillCompleteness },
    './guides': { guides },
    './hubs': { hubPages: hubs },
    './info-pages': { infoPages: infos },
    './info-content': infoContent,
  };
}

const linkPattern = /^- \[[^\]]+\]\((https:\/\/[^)\s]+)\)(?:: .+)?$/;
const headingsOf = (text) => text.split('\n').filter((line) => /^#{1,6} /.test(line));
const urlsIn = (text) => [...text.matchAll(/https?:\/\/[^\s)]+/g)].map((match) => match[0]);

test('llms.txt follows the convention: H1, summary, notes, link sections in order, Optional last', () => {
  const text = llmsFor().llmsTxt();
  assert.match(text, /^# Freelance Place\n\n> [^\n]+\n\n- [^\n]+\n/, 'H1, blockquote summary, then the notes');
  assert.equal(text.endsWith('\n') && !text.endsWith('\n\n'), true);
  const headings = headingsOf(text);
  assert.equal(headings[0], '# Freelance Place');
  assert.equal(headings.filter((heading) => heading.startsWith('# ')).length, 1, 'one H1');
  assert.equal(headings.some((heading) => /^#{3,}/.test(heading)), false, 'only H1 and H2');
  const sections = headings.slice(1).map((heading) => heading.slice(3));
  assert.equal(sections.at(-1), 'Optional');
  const order = sections.slice(0, -1).map((name) => SECTION_ORDER.indexOf(name));
  assert.equal(order.every((index) => index >= 0), true, `known sections only: ${sections}`);
  assert.deepEqual(order, [...order].sort((a, b) => a - b), `sections keep the conventional order: ${sections}`);
  assert.equal(new Set(sections).size, sections.length);

  // Every section is a list of `- [title](absolute url): note` lines, and only that.
  const bodies = text.split(/^## .*$/m).slice(1).map((body) => body.trim().split('\n'));
  assert.equal(bodies.length, sections.length);
  for (const lines of bodies) for (const line of lines) assert.match(line, linkPattern, line);
  for (const url of urlsIn(text)) assert.equal(url === SITE_URL || url.startsWith(`${SITE_URL}/`), true, url);
  const optional = bodies.at(-1).join('\n');
  for (const path of ['/sitemap.xml', '/llms-full.txt']) assert.ok(optional.includes(`](${SITE_URL}${path})`), path);
});

test('llms.txt lists exactly the indexable registry pages that carry a note, titled as the registry titles them', () => {
  const registry = loadModule('src/lib/seo/registry.ts');
  const text = llmsFor().llmsTxt();
  const expected = registry.indexablePages().filter((entry) => entry.llms);
  assert.ok(expected.length >= 8);
  for (const entry of expected) {
    const label = entry.title.replace(/[[\]]/g, '\\$&');
    assert.ok(text.includes(`- [${label}](${SITE_URL}${entry.path})`), entry.path);
    assert.ok(text.includes(`${SITE_URL}${entry.path})`));
  }
  const listed = [...text.split('## Optional')[0].matchAll(/\]\((https:\/\/[^)]+)\)/g)].map((match) => match[1]);
  assert.equal(listed.length, expected.length, 'nothing else is listed');
  assert.equal(new Set(listed).size, listed.length);
});

test('llms.txt facts follow the billing state and come from the shared facts', () => {
  for (const [env, available] of [[billingOn, true], [billingOff, false]]) {
    const facts = factsFor(env);
    const membership = facts.membershipFacts(env);
    const text = llmsFor(env).llmsTxt();
    assert.equal(membership.billingAvailable, available);
    assert.ok(text.includes(`${membership.trialDays}-day trial`));
    assert.ok(text.includes(`ILS ${membership.priceIls.toFixed(2)} per month`));
    assert.equal(text.includes('Membership costs ILS'), available);
    assert.equal(text.includes('renews automatically until cancelled'), available);
    assert.equal(text.includes('Payment is not yet available'), !available);
    assert.equal(text.includes('Membership is planned at ILS'), !available);
    assert.ok(text.includes(facts.membershipAnswer(membership)), 'the Hebrew pricing answer is the one the site shows');
    assert.doesNotMatch(text, /AI agent|AI-agent|sample project|demo project|סוכן AI/i, 'llms.txt says nothing about showcase projects');
    assert.ok(text.includes(facts.contactFacts().email));
    assert.ok(text.includes(facts.contactFacts().operator));
    assert.doesNotMatch(text, /not in the sitemap|not indexed/i);
    // The XPlace comparison lines come from the dated, sourced comparison data; the price line needs an available paid offer.
    const lines = loadModule('src/lib/seo/comparison.ts', { env }).llmsComparisonLines(membership);
    assert.equal(lines.some((line) => /ILS \d+ per month/.test(line) && /before VAT/.test(line)), available, 'the price comparison appears only while billing is available');
    assert.ok(lines.some((line) => /Lighthouse/.test(line)), 'the speed comparison is stated with its tool and date');
    for (const line of lines) assert.ok(text.includes(line), line.slice(0, 60));
  }
  // Nothing is typed by hand: other numbers flow straight through.
  const text = llmsFor().llmsTxt({ priceIls: 24.5, priceLabel: '₪24.50', trialDays: 30, billingAvailable: true });
  assert.match(text, /Membership costs ILS 24\.50 per month/);
  assert.match(text, /30-day trial/);
  assert.match(text, /30 ימי ניסיון/);
  assert.doesNotMatch(text, /19\.99|14-day|14 ימי/);
});

test('pages the registry marks not indexable never appear in llms.txt or llms-full.txt', () => {
  const hidden = page('/hidden-hub', { kind: 'hub', indexable: false, llms: { section: 'Product', note: 'HIDDEN-HUB-NOTE' } });
  const visible = page('/visible-hub', { kind: 'hub', llms: { section: 'Product', note: 'VISIBLE-HUB-NOTE' } });
  const unlisted = page('/no-note-hub', { kind: 'hub' });
  const thin = skill('thin', { deliverables: [] });
  const full = skill('full');
  assert.equal(skillCompleteness(thin).complete, false);
  assert.equal(skillCompleteness(full).complete, true);
  const llms = llmsFor(billingOn, stubsFor({ hubs: [hidden, visible, unlisted], skills: [full, thin] }));
  const small = llms.llmsTxt();
  const large = llms.llmsFullTxt();
  for (const text of [small, large]) {
    assert.ok(text.includes(`${SITE_URL}/visible-hub`), 'indexable pages with a note are listed');
    assert.ok(text.includes('VISIBLE-HUB-NOTE'));
    assert.ok(text.includes(`${SITE_URL}/skills/full`));
    for (const absent of ['/hidden-hub', 'HIDDEN-HUB-NOTE', '/skills/thin', 'כישור thin', 'הגדרה ייחודית של thin', '/no-note-hub']) assert.equal(text.includes(absent), false, absent);
  }
  assert.equal(large.includes('תוצר ראשון thin'), false);
  // A sample of the real registry: every non-indexable page is absent.
  const registry = loadModule('src/lib/seo/registry.ts');
  for (const entry of registry.allPages().filter((candidate) => candidate.indexable === false)) {
    assert.equal(llmsFor().llmsFullTxt().includes(`${SITE_URL}${entry.path}`), false, entry.path);
  }
});

test('llms-full.txt carries the facts, both FAQs and the category summaries from the shared data', () => {
  for (const env of [billingOn, billingOff]) {
    const facts = factsFor(env);
    const membership = facts.membershipFacts(env);
    const content = loadModule('src/lib/seo/content.ts', { env });
    const text = llmsFor(env).llmsFullTxt();
    assert.match(text, /^# Freelance Place\n\n> [^\n]+\n\n/);
    assert.equal(headingsOf(text).filter((heading) => heading.startsWith('# ')).length, 1, 'one H1');
    for (const line of llmsFor(env).factLines(membership)) assert.ok(text.includes(line.replace(/\s+/g, ' ')), line.slice(0, 60));
    for (const item of [...content.getHomeQuestions(membership), ...content.getComparisonQuestions(membership)]) {
      assert.ok(text.includes(`### ${item.question}\n\n${item.answer}`), item.question);
    }
    for (const category of content.categories) {
      assert.ok(text.includes(`### ${category.title}\n\nSource: ${SITE_URL}/categories/${category.slug}\n\n${category.intro}`), category.slug);
      assert.ok(text.includes(category.scope) && text.includes(category.selection));
      assert.ok(text.includes(`#### ${category.question}\n\n${category.answer}`));
      assert.ok(text.includes(category.skills.join(', ')));
    }
    assert.ok(text.includes(`## Comparison with XPlace.com\n\nSource: ${SITE_URL}/alternatives/xplace`));
    assert.doesNotMatch(text, /PLACEHOLDER/);
  }
});

test('llms-full.txt includes skills, guides and info pages when the registry lists them, and omits empty sections', () => {
  const empty = llmsFor(billingOn, stubsFor()).llmsFullTxt();
  const emptyHeadings = headingsOf(empty);
  for (const heading of ['## Skills', '## Guides', '## Information pages']) assert.equal(emptyHeadings.includes(heading), false, `${heading} is omitted while empty`);
  assert.doesNotMatch(empty, /PLACEHOLDER/, 'info content is read only for registered pages');
  assert.equal(empty.includes('מחירים בדיקה'), false);

  const infos = ['/pricing', '/about', '/faq'].map((path) => page(path, { modified: '2026-11-05', llms: { section: 'Product', note: `note ${path}` } }));
  const text = llmsFor(billingOn, stubsFor({ skills: [skill('alpha'), skill('beta')], guides: [guide('first'), guide('second')], infos })).llmsFullTxt();
  const headings = headingsOf(text);
  for (const heading of ['## Skills', '## Guides', '## Information pages']) assert.ok(headings.includes(heading), heading);
  assert.ok(headings.indexOf('## Skills') < headings.indexOf('## Guides') && headings.indexOf('## Guides') < headings.indexOf('## Information pages'));

  // Skills: definition, deliverables and questions.
  const alpha = skill('alpha');
  assert.ok(text.includes(`### כישור alpha\n\nSource: ${SITE_URL}/skills/alpha\nLast updated: 2026-11-02\n\n${alpha.definition}`));
  assert.ok(text.includes(`Deliverables:\n${alpha.deliverables.map((item) => `- ${item}`).join('\n')}`));
  assert.ok(text.includes(`#### ${alpha.questions[0].question}\n\n${alpha.questions[0].answer}`));
  assert.ok(text.includes('### כישור beta'));
  // Guides: summary and section answers only; long-form paragraphs stay on the page.
  const first = guide('first');
  assert.ok(text.includes(`### ${first.title}\n\nSource: ${SITE_URL}/guides/first\nLast updated: 2026-11-03\n\nSummary: ${first.summary}`));
  assert.ok(text.includes(`#### ${first.sections[0].heading}\n\n${first.sections[0].answer}`));
  assert.ok(text.includes(first.disclaimer));
  assert.equal(text.includes('פסקה ארוכה'), false);
  // Info pages: only those that are registered, with their summary, answers, questions and disclaimer.
  assert.ok(text.includes(`### מחירים בדיקה\n\nSource: ${SITE_URL}/pricing\nLast updated: 2026-11-05\n\nבקיצור מחירים.`));
  assert.ok(text.includes('#### מה חינם?\n\nפרסום חינם.'));
  assert.ok(text.includes('#### כמה זה עולה?\n\nתשובת מחיר.'));
  assert.ok(text.includes('הבהרת מחיר.'));
  assert.equal(text.includes('פסקת מחיר ארוכה'), false);
  assert.ok(text.includes('### אודות בדיקה'));
  assert.ok(text.includes('#### קבוצה ראשונה\n\n##### שאלה בקבוצה?\n\nתשובה בקבוצה.'));
  assert.equal(text.includes('איך זה עובד בדיקה'), false, 'how-it-works is not registered, so it is not mentioned');
  for (const url of urlsIn(text)) assert.equal(url === SITE_URL || url.startsWith(`${SITE_URL}/`), true, url);
});

test('both files are deterministic and stay small', () => {
  const stubs = stubsFor({ skills: Array.from({ length: 24 }, (_, index) => skill(`skill-${index}`)), guides: Array.from({ length: 9 }, (_, index) => guide(`guide-${index}`)) });
  for (const [env, extra] of [[billingOn, {}], [billingOff, stubs]]) {
    const llms = llmsFor(env, extra);
    assert.equal(llms.llmsTxt(), llms.llmsTxt());
    assert.equal(llms.llmsFullTxt(), llms.llmsFullTxt());
    assert.equal(llms.llmsTxt(), llmsFor(env, extra).llmsTxt(), 'independent of module state');
    assert.ok(llms.llmsTxt().length < 20_000, `llms.txt ${llms.llmsTxt().length}`);
    assert.ok(llms.llmsFullTxt().length < 200_000, `llms-full.txt ${llms.llmsFullTxt().length}`);
  }
  assert.doesNotMatch(llmsFor().llmsFullTxt(), /\d{4}-\d{2}-\d{2}T|Generated at/, 'no run-time timestamps');
});

test('the routes serve the generated text as plain text, noindex and cacheable', async () => {
  const llms = llmsFor(billingOn);
  for (const env of [billingOn, billingOff, {}]) {
    for (const [entry, generate] of [['src/app/llms.txt/route.ts', 'llmsTxt'], ['src/app/llms-full.txt/route.ts', 'llmsFullTxt']]) {
      const route = loadModule(entry, { env });
      const response = route.GET();
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('content-type'), 'text/plain; charset=utf-8');
      assert.equal(response.headers.get('x-robots-tag'), 'noindex');
      assert.equal(response.headers.get('cache-control'), 'public, max-age=300, s-maxage=3600');
      assert.equal(route.dynamic, 'force-dynamic');
      assert.equal(await response.text(), loadModule('src/lib/seo/llms.ts', { env })[generate]());
    }
  }
  assert.ok((await llms.llmsResponse('x').text()) === 'x');
});

test('llms code takes URLs from site.ts and hard-codes neither an origin nor a price', () => {
  for (const file of ['src/lib/seo/llms.ts', 'src/app/llms.txt/route.ts', 'src/app/llms-full.txt/route.ts']) {
    const source = readFileSync(`${projectRoot}/${file}`, 'utf8');
    assert.doesNotMatch(source, /freelance-place\.com|localhost/, file);
    assert.doesNotMatch(source, /19\.99|1999/, file);
  }
});
