import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadModule, projectRoot } from './helpers/load-ts.mjs';

const ORIGIN = 'https://freelance-place.com';
const billingOn = { BILLING_ENABLED: 'true', CARDCOM_TERMINAL_NUMBER: '1', CARDCOM_API_NAME: 'x', NEXT_PUBLIC_SITE_URL: ORIGIN };
const billingOff = { NEXT_PUBLIC_SITE_URL: ORIGIN };
const plain = (value) => JSON.parse(JSON.stringify(value));
const load = (entry, env = { SITE_INDEXABLE: 'true' }) => loadModule(entry, { env: { SITE_INDEXABLE: 'true', ...env } });

const factsModule = load('src/lib/seo/facts.ts');
const content = load('src/lib/seo/content.ts');
const site = load('src/lib/seo/site.ts');
const registry = load('src/lib/seo/registry.ts');
const cardcom = load('src/lib/billing/cardcom.ts');
const membershipState = load('src/lib/membership/state.ts');
const factsOn = factsModule.membershipFacts(billingOn);
const factsOff = factsModule.membershipFacts(billingOff);

test('membership facts derive price, trial length and billing availability from code and config', () => {
  assert.equal(factsOn.priceIls, cardcom.PRICE_AGOROT / 100);
  assert.equal(factsOn.priceLabel, `₪${(cardcom.PRICE_AGOROT / 100).toFixed(2)}`);
  assert.equal(factsOn.trialDays, membershipState.TRIAL_MS / 86_400_000);
  assert.equal(factsOn.billingAvailable, true);
  assert.equal(factsOff.billingAvailable, false);
  assert.equal(factsModule.membershipFacts({ ...billingOn, BILLING_ENABLED: 'false' }).billingAvailable, false);
  assert.equal(factsModule.membershipFacts({ ...billingOn, CARDCOM_API_NAME: '' }).billingAvailable, false);
  assert.equal(factsModule.membershipFacts({ ...billingOn, NEXT_PUBLIC_SITE_URL: 'http://localhost:3000' }).billingAvailable, false);
  const runtime = load('src/lib/seo/facts.ts', billingOn);
  assert.equal(runtime.membershipFacts().billingAvailable, true, 'defaults to process.env');
  assert.equal(factsModule.BRAND.nameHe, 'פרילנס פלייס');
  assert.equal(factsModule.contactFacts().email, load('src/lib/legal/identity.ts').legalEmail);
});

test('facts follow the code constants: no price or trial number is typed in the copy modules', () => {
  const facts = { priceIls: 24.5, priceLabel: '₪24.50', trialDays: 30, billingAvailable: true };
  const answer = factsModule.membershipAnswer(facts);
  assert.match(answer, /₪24\.50 לחודש/);
  assert.match(answer, /30 ימי ניסיון/);
  assert.doesNotMatch(answer, /19\.99|14/);
  assert.doesNotMatch(factsModule.membershipAnswer({ ...facts, billingAvailable: false }), /19\.99|14/);
  for (const file of ['src/lib/seo/facts.ts', 'src/lib/seo/content.ts', 'src/app/alternatives/xplace/page.tsx', 'src/app/page.tsx', 'src/app/llms.txt/route.ts']) {
    assert.doesNotMatch(readFileSync(`${projectRoot}/${file}`, 'utf8'), /19\.99|1999/, `${file} must not hard-code the price`);
  }
});

test('pricing answer matches the required copy for both billing states', () => {
  assert.equal(factsModule.membershipAnswer(factsOn), 'פרסום פרויקטים חינם. פרילנסרים מקבלים 60 ימי ניסיון להגשת הצעות אחרי שמירת פרופיל שהושלם, ואחריהם אפשר להצטרף לחברות ב־₪19.99 לחודש (כולל מע״מ ככל שחל), שמתחדשת אוטומטית עד לביטול. ללא הצטרפות אין חיוב בסיום הניסיון. התנאים המלאים מופיעים בתנאי השימוש.');
  const off = factsModule.membershipAnswer(factsOff);
  assert.match(off, /^פרסום פרויקטים חינם\. פרילנסרים מקבלים 60 ימי ניסיון להגשת הצעות אחרי שמירת פרופיל שהושלם/);
  assert.match(off, /מחיר החברות המתוכנן הוא ₪19\.99 לחודש; התשלום עדיין אינו זמין ולא מופעל חיוב\.$/);
  assert.doesNotMatch(off, /מתחדשת אוטומטית|ללא הצטרפות/, 'no paid-offer claims while billing is unavailable');
  assert.match(factsModule.aiAgentAnswer, /סוכן AI/);
  assert.match(factsModule.aiAgentAnswer, /^לא\./);
});

const inactivePhrase = /עדיין אינ|אינם פעילים|אינה פעילה|מתוכנן|לא מופעל חיוב/;
const stale = /לא נכללים במפת האתר|לא מאונדקסים|אינם נכללים במפת האתר|not indexed/i;

test('home FAQ is truthful for both billing states and never claims showcase projects are unindexed', () => {
  for (const [facts, available] of [[factsOn, true], [factsOff, false]]) {
    const questions = content.getHomeQuestions(facts);
    const text = questions.map((item) => `${item.question} ${item.answer}`).join('\n');
    const price = questions.find((item) => item.question === 'כמה עולה להשתמש באתר?');
    assert.ok(price);
    assert.equal(price.answer, factsModule.membershipAnswer(facts));
    assert.equal(inactivePhrase.test(price.answer), !available, `billing ${available ? 'available' : 'unavailable'}`);
    assert.doesNotMatch(text, stale);
    assert.match(questions.find((item) => item.question.startsWith('האם כל פרויקט')).answer, /מסומנים "סוכן AI"/);
  }
});

test('comparison copy follows the billing state and keeps the no-escrow statement', () => {
  const on = content.comparisonPaymentsParagraph(factsOn);
  const off = content.comparisonPaymentsParagraph(factsOff);
  assert.match(on, /60 ימי ניסיון/);
  assert.match(on, /₪19\.99 לחודש/);
  assert.match(on, /חידוש אוטומטי עד לביטול/);
  assert.doesNotMatch(on, /עדיין אינו זמין|מתוכנן/);
  assert.match(off, /המתוכנן הוא ₪19\.99 לחודש, והתשלום עדיין אינו זמין/);
  assert.doesNotMatch(off, /חידוש אוטומטי/);
  for (const paragraph of [on, off]) {
    assert.match(paragraph, /נאמנות \(escrow\)/);
    assert.match(paragraph, /הגנת תשלום אינם מוצעים/);
    assert.doesNotMatch(paragraph, stale);
  }
  assert.match(content.comparisonMembershipCell(factsOn), /₪19\.99 לחודש בחידוש אוטומטי/);
  assert.doesNotMatch(content.comparisonMembershipCell(factsOn), inactivePhrase);
  assert.match(content.comparisonMembershipCell(factsOff), /מחיר מתוכנן: ₪19\.99 לחודש\. התשלום עדיין אינו זמין\./);
  for (const facts of [factsOn, factsOff]) {
    assert.doesNotMatch(content.getComparisonQuestions(facts).map((item) => item.answer).join(' '), stale);
  }
  const questions = content.getComparisonQuestions(factsOn);
  assert.equal(new Set(questions.map((item) => item.question)).size, questions.length);
});

test('llms.txt product facts follow the billing state', () => {
  const route = (env) => loadModule('src/app/llms.txt/route.ts', { env: { SITE_INDEXABLE: 'true', ...env } });
  return Promise.all([route(billingOn).GET().text(), route(billingOff).GET().text()]).then(([on, off]) => {
    assert.match(on, /Membership costs ILS 19\.99 per month/);
    assert.doesNotMatch(on, /Billing is not active|not yet available/);
    assert.match(off, /Payment is not yet available/);
    assert.match(off, /ILS 19\.99 per month/);
    for (const text of [on, off]) {
      assert.match(text, /60-day trial/);
      assert.match(text, /labeled "AI agent"/);
      assert.doesNotMatch(text, /not in the sitemap|not indexed/i);
    }
  });
});

test('categories: one matching rule shared by the category page and project breadcrumbs', () => {
  const design = content.categories.find((category) => category.slug === 'design');
  const byLabel = { category: 'עיצוב וגרפיקה', skills: [] };
  const bySkill = { category: 'כללי', skills: ['figma'] };
  const none = { category: 'כללי', skills: ['Cooking'] };
  assert.equal(content.projectMatchesCategory(byLabel, design), true);
  assert.equal(content.projectMatchesCategory(bySkill, design), true, 'skills match case-insensitively');
  assert.equal(content.projectMatchesCategory(none, design), false);
  assert.equal(content.categoryForProject(byLabel).slug, 'design');
  assert.equal(content.categoryForProject(bySkill).slug, 'design');
  assert.equal(content.categoryForProject(none), undefined);
  // A label match wins over a skill match in another category.
  assert.equal(content.categoryForProject({ category: 'פיתוח אתרים', skills: ['Figma'] }).slug, 'web-development');
  const page = readFileSync(`${projectRoot}/src/app/categories/[slug]/page.tsx`, 'utf8');
  assert.match(page, /projectMatchesCategory\(project, category\)/);
});

test('pageMetadata v2: hreflang, per-page image alt, absolute title and article dates', () => {
  const page = site.pageMetadata('כותרת לדוגמה', 'תיאור', '/guides/example');
  assert.deepEqual(JSON.parse(JSON.stringify(page.alternates)), { canonical: `${ORIGIN}/guides/example`, languages: { 'he-IL': `${ORIGIN}/guides/example`, 'x-default': `${ORIGIN}/guides/example` } });
  assert.equal(page.title, 'כותרת לדוגמה');
  assert.equal(page.openGraph.type, 'website');
  assert.equal(page.openGraph.title, 'כותרת לדוגמה | Freelance Place');
  assert.equal(page.openGraph.images[0].alt, 'כותרת לדוגמה');
  assert.equal(page.twitter.images[0].alt, 'כותרת לדוגמה');
  assert.equal(page.openGraph.publishedTime, undefined);

  const article = site.pageMetadata('מדריך', 'תיאור', '/guides/example', true, { type: 'article', published: '2026-11-01', modified: '2026-11-08' });
  assert.equal(article.openGraph.type, 'article');
  assert.equal(article.openGraph.publishedTime, '2026-11-01');
  assert.equal(article.openGraph.modifiedTime, '2026-11-08');

  const absolute = site.pageMetadata('Freelance Place — דף הבית', 'תיאור', '/', true, { absoluteTitle: true });
  assert.deepEqual(JSON.parse(JSON.stringify(absolute.title)), { absolute: 'Freelance Place — דף הבית' });
  assert.equal(absolute.openGraph.title, 'Freelance Place — דף הבית');
  assert.equal(site.pageMetadata('x', 'y', '/p', false).robots.index, false);
});

test('home metadata uses the branded absolute title and keeps the XPlace angle in the description', () => {
  const home = registry.metadataFor('/');
  assert.equal(home.title.absolute, 'Freelance Place — פרויקטים לפרילנסרים ופרסום פרויקט בחינם');
  assert.match(home.description, /XPlace\.com/);
  assert.equal(registry.metadataFor('/guides/project-brief').openGraph.type, 'article');
  assert.equal(registry.metadataFor('/guides/project-brief').openGraph.modifiedTime, '2026-11-08');
  assert.equal(registry.metadataFor('/privacy').title, registry.pageByPath('/privacy').title);
  assert.throws(() => registry.metadataFor('/missing'), /No SEO page/);
});

test('summarize cuts at a sentence or word boundary and never exceeds the limit', () => {
  const { summarize } = site;
  assert.equal(summarize('קצר', 50), 'קצר');
  assert.equal(summarize('  רווחים   מרובים  ', 50), 'רווחים מרובים');
  const sentences = 'המשפט הראשון הושלם כאן. המשפט השני ממשיך הלאה ואינו נכנס במלואו בגבול שנקבע.';
  assert.equal(summarize(sentences, 40), 'המשפט הראשון הושלם כאן.…');
  const words = 'אנחנו מחפשים פרילנסר לבניית אתר תדמית מהיר ונגיש לסטודיו בוטיק בעל מוניטין';
  for (const max of [20, 31, 47, 60]) {
    const result = summarize(words, max);
    assert.ok(result.length <= max, `${result.length} <= ${max}`);
    assert.ok(result.endsWith('…'));
    const body = result.slice(0, -1);
    assert.ok(words.startsWith(body), 'is a prefix of the source');
    assert.ok(words[body.length] === ' ', `cut at a word boundary: "${result}"`);
  }
  assert.equal(summarize('אבגדהוזחטיכלמנסעפצקרשת', 10).length, 10, 'a single long word is hard-cut');
  assert.doesNotMatch(summarize('אחת, שתיים, שלוש, ארבע, חמש, שש', 17), /,…$/);
});

test('registry invariants: unique paths, length windows, valid dates and a consistent sitemap', () => {
  const pages = registry.allPages();
  const paths = pages.map((page) => page.path);
  assert.equal(new Set(paths).size, paths.length, 'unique paths');
  const date = /^\d{4}-\d{2}-\d{2}$/;
  const valid = (value) => date.test(value) && new Date(`${value}T00:00:00Z`).toISOString().startsWith(value);
  for (const page of pages) {
    assert.match(page.path, /^\/($|[a-z0-9][a-z0-9/_-]*[a-z0-9]$)/, `path shape ${page.path}`);
    assert.ok(page.title.length >= 20 && page.title.length <= 60, `title length ${page.path}: ${page.title.length}`);
    assert.ok(page.description.length >= 70 && page.description.length <= 165, `description length ${page.path}: ${page.description.length}`);
    for (const key of ['published', 'modified']) if (page[key] !== undefined) assert.ok(valid(page[key]), `${key} date ${page.path}`);
    if (page.published && page.modified) assert.ok(page.modified >= page.published, `modified >= published ${page.path}`);
  }
  assert.equal(new Set(pages.map((page) => page.title)).size, pages.length, 'unique titles');
  assert.equal(new Set(pages.map((page) => page.description)).size, pages.length, 'unique descriptions');
  assert.deepEqual(plain(registry.indexablePages().map((page) => page.path)), plain(pages.filter((page) => page.indexable !== false).map((page) => page.path)));
  assert.deepEqual(plain(content.editorialPaths), plain(registry.indexablePages().map((page) => page.path)));
  assert.equal(registry.pageByPath('/terms').modified, load('src/lib/legal/identity.ts').legalUpdated);
  assert.equal(registry.pageByPath('/missing'), undefined);
  for (const category of content.categories) assert.ok(registry.pageByPath(`/categories/${category.slug}`), category.slug);
  for (const privatePath of site.privatePaths) assert.equal(registry.pageByPath(privatePath), undefined, `${privatePath} stays out of the registry`);
});

test('registry resolves related paths of guides and skills, and only complete skills are indexable', () => {
  const guide = (slug, related = []) => ({ slug, title: `מדריך בדיקה ארוך מספיק ${slug}`, description: 'ת'.repeat(80), audience: 'both', published: '2026-11-01', modified: '2026-11-02', summary: 'ס', sections: [], faq: [], related });
  const longText = Array.from({ length: 60 }, (_, index) => `מילה${index}`).join(' ');
  const skill = (slug, over = {}) => ({ slug, name: slug, aliases: [], category: 'design', title: `כישור בדיקה ארוך מספיק ${slug}`, description: 'ת'.repeat(80), definition: longText, whenNeeded: longText, deliverables: ['א', 'ב', 'ג', 'ד'], howToChoose: ['א', 'ב', 'ג', 'ד'], priceDrivers: ['א', 'ב', 'ג'], questions: [{ question: longText, answer: longText }, { question: 'ש', answer: 'ת' }, { question: 'ש2', answer: 'ת2' }], related: [], published: '2026-11-01', modified: '2026-11-02', ...over });
  const skillsModule = load('src/lib/seo/skills.ts');
  assert.equal(skillsModule.skillCompleteness(skill('full')).complete, true);
  assert.deepEqual(Object.keys(skillsModule.skills), [], 'stub stays empty in the foundation package');
  for (const [name, over, issue] of [
    ['short', { definition: 'קצר' }, /definition/], ['deliv', { deliverables: ['א'] }, /deliverables/],
    ['choose', { howToChoose: ['א'] }, /selection/], ['price', { priceDrivers: ['א'] }, /price drivers/],
    ['qs', { questions: [] }, /questions/], ['thin', { whenNeeded: '', questions: [{ question: 'ש', answer: 'ת' }, { question: 'ש', answer: 'ת' }, { question: 'ש', answer: 'ת' }], definition: 'ת'.repeat(90) }, /words/],
  ]) {
    const result = skillsModule.skillCompleteness(skill(name, over));
    assert.equal(result.complete, false, name);
    assert.ok(result.issues.some((message) => issue.test(message)), `${name}: ${result.issues}`);
  }
  const withData = loadModule('src/lib/seo/registry.ts', {
    env: { SITE_INDEXABLE: 'true' },
    stubs: {
      './guides': { guides: [guide('one', ['/guides/two']), guide('two', ['/skills/full'])] },
      './skills': { skills: [skill('full'), skill('thin', { deliverables: [] })], skillCompleteness: skillsModule.skillCompleteness },
    },
  });
  const pages = withData.allPages();
  const known = new Set(pages.map((page) => page.path));
  for (const related of ['/guides/two', '/skills/full']) assert.ok(known.has(related));
  assert.equal(withData.pageByPath('/skills/full').indexable, true);
  assert.equal(withData.pageByPath('/skills/thin').indexable, false);
  assert.equal(withData.indexablePages().some((page) => page.path === '/skills/thin'), false);
  assert.equal(withData.pageByPath('/guides/one').kind, 'guide');
  assert.equal(withData.metadataFor('/skills/thin').robots.index, false, 'incomplete skills are noindex');
  assert.equal(withData.metadataFor('/guides/one').openGraph.publishedTime, '2026-11-01');
});

test('sitemap lastModified comes only from declared page dates', async () => {
  const route = loadModule('src/app/sitemap.ts', {
    env: { SITE_INDEXABLE: 'true' },
    stubs: { '@/lib/seo/projects': { sitemapProjects: async () => [] } },
  });
  const entries = await route.default();
  const byUrl = new Map(entries.map((entry) => [entry.url, entry]));
  assert.equal(byUrl.get(`${ORIGIN}/`).lastModified, undefined, 'home has no real date');
  assert.equal(byUrl.get(`${ORIGIN}/terms`).lastModified, load('src/lib/legal/identity.ts').legalUpdated);
  assert.equal(byUrl.get(`${ORIGIN}/guides/project-brief`).lastModified, '2026-11-08');
  assert.equal(byUrl.get(`${ORIGIN}/alternatives/xplace`).lastModified, '2026-11-08');
  assert.equal(entries.length, registry.indexablePages().length);
});

test('new code does not hard-code the production origin or localhost', () => {
  for (const file of ['src/lib/seo/facts.ts', 'src/lib/seo/schema.ts', 'src/lib/seo/registry.ts', 'src/lib/seo/content.ts', 'src/lib/seo/types.ts', 'src/lib/legal/identity.ts']) {
    assert.doesNotMatch(readFileSync(`${projectRoot}/${file}`, 'utf8'), /freelance-place\.com|localhost/, file);
  }
});
