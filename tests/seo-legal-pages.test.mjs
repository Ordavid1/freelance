// The legal pages (/privacy, /terms) and the claims about tracking that sit next to them: both carry a visible breadcrumb with
// BreadcrumbList and WebPage structured data built from the registry, the site has a /favicon.ico, and what the FAQ says about
// cookies and analytics matches what the layout loads and what the privacy policy states.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { projectRoot } from './helpers/load-ts.mjs';
import { ORIGIN, createElement, jsonLd, load, ofType, render } from './helpers/seo-pages-harness.mjs';

const read = (file) => readFileSync(`${projectRoot}/${file}`, 'utf8');
const supportStub = { '@/components/support-chat': { SupportHeaderActions: ({ children }) => createElement('div', { className: 'actions' }, children) } };
const registry = load('src/lib/seo/registry.ts');
const legal = load('src/components/legal-document.tsx', { stubs: supportStub });
const sections = [{ id: 'one', title: 'סעיף ראשון', content: createElement('p', null, 'תוכן') }];

for (const [path, title] of [['/privacy', 'מדיניות פרטיות'], ['/terms', 'תנאי שימוש']]) {
  test(`legal page ${path}: a visible breadcrumb, and BreadcrumbList and WebPage data built from the registry entry`, () => {
    const entry = registry.requirePage(path);
    assert.equal(entry.kind, 'legal');
    const html = render(createElement(legal.LegalDocument, { path, title, intro: 'פתיח', sections }));
    assert.match(html, /<nav class="legal-crumbs" aria-label="פירורי לחם"><ol><li><a href="\/">דף הבית<\/a><\/li><li><span aria-current="page">[^<]+<\/span><\/li><\/ol><\/nav>/);
    assert.ok(html.includes(`<span aria-current="page">${title}</span>`), 'the last crumb is the page itself and is not a link');
    assert.equal((html.match(/<h1[ >]/g) ?? []).length, 1, 'still one h1');
    const [breadcrumb] = ofType(html, 'BreadcrumbList');
    assert.deepEqual(breadcrumb.itemListElement.map((item) => [item.position, item.name, item.item]), [[1, 'דף הבית', `${ORIGIN}/`], [2, title, `${ORIGIN}${path}`]]);
    const [page] = ofType(html, 'WebPage');
    assert.equal(page['@id'], `${ORIGIN}${path}#page`);
    assert.equal(page.url, `${ORIGIN}${path}`);
    assert.equal(page.name, entry.title, 'the name is the registry title, like the <title>');
    assert.equal(page.description, entry.description);
    assert.equal(page.dateModified, entry.modified);
    assert.equal(ofType(html, 'WebPage').length, 1);
    const nodes = jsonLd(html);
    assert.equal(nodes.length, 2, 'the site graph is in the layout; the page adds its breadcrumb and its WebPage');
    assert.ok(html.indexOf('legal-crumbs') < html.indexOf('legal-header'), 'the trail comes before the heading');
  });

  test(`legal page ${path}: the route passes its registered path to the document`, () => {
    const source = read(`src/app${path}/page.tsx`);
    assert.match(source, new RegExp(`<LegalDocument path="${path}" title="${title}"`));
    assert.match(source, new RegExp(`metadataFor\\('${path}'\\)`), 'metadata and breadcrumb come from the same registry entry');
  });
}

test('legal pages: the breadcrumb is hidden when printed, like the other navigation', () => {
  const css = read('src/app/legal.css');
  assert.match(css, /@media print\{[^}]*\.legal-crumbs[^}]*display:none/);
  assert.match(css, /\.legal-crumbs ol\{display:flex/);
});

test('/favicon.ico exists next to the icon and apple-icon, as a real multi-size ICO file', () => {
  assert.ok(existsSync(`${projectRoot}/src/app/icon.svg`) && existsSync(`${projectRoot}/src/app/apple-icon.png`));
  const file = `${projectRoot}/src/app/favicon.ico`;
  assert.ok(existsSync(file), 'crawlers, browsers and link unfurlers ask for /favicon.ico directly');
  const bytes = readFileSync(file);
  assert.deepEqual([...bytes.subarray(0, 4)], [0, 0, 1, 0], 'ICO header: reserved 0, type 1');
  const count = bytes.readUInt16LE(4);
  assert.ok(count >= 3, `16, 32 and 48 px images (has ${count})`);
  const sizes = Array.from({ length: count }, (_, index) => bytes[6 + index * 16] || 256).sort((a, b) => a - b);
  assert.deepEqual(sizes.slice(0, 3), [16, 32, 48]);
  assert.ok(bytes.length < 20_000, 'small enough to be fetched on every first visit');
});

test('the FAQ answer about cookies and analytics matches what the layout loads and what the privacy policy states', () => {
  const layout = read('src/app/layout.tsx');
  const privacy = read('src/app/privacy/page.tsx');
  const loadsAnalytics = /googletagmanager\.com\/gtag\/js/.test(layout);
  assert.ok(loadsAnalytics, 'this guard follows the Google tag in the layout: update the FAQ answer and this test together if it is removed');
  assert.match(privacy, /האתר טוען Google Analytics 4 למדידת שימוש/, 'the policy says the same thing');
  const facts = load('src/lib/seo/facts.ts').membershipFacts({});
  const faq = load('src/lib/seo/info-content.ts').faqContent(facts);
  const answers = faq.groups.flatMap((group) => group.items);
  const item = answers.find((entry) => /עוגיות/.test(entry.question));
  assert.ok(item, 'the FAQ answers a question about cookies');
  assert.match(item.answer, /Google Analytics 4/);
  assert.match(item.answer, /_ga/);
  assert.match(item.answer, /אין באתר מסך בחירת הסכמה/, 'says what the policy says about consent today');
  assert.match(item.answer, /מדיניות הפרטיות/);
  // The old answer denied analytics altogether; no text on the site may say the site has none while the tag is loaded.
  for (const group of faq.groups) for (const entry of group.items) assert.doesNotMatch(`${entry.question} ${entry.answer}`, /אין בו כלי אנליטיקה|פיקסלי פרסום|לא\. העוגיות/);
});
