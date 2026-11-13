// Structure of the answer-first article layout (GuideArticle, InfoArticle and the shared section
// renderer): semantic HTML, answer-first order, escaping, optional blocks, and text that matches
// the structured data. Routes, registry entries and policy checks are in seo-pages.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { documentFor, visibleText } from './helpers/html.mjs';
import { bareGuide, bothGuide, fixtureGuides, infoContent, sampleGuide } from './fixtures/seo-pages.fixtures.mjs';
import {
  assertInOrder, assertWellFormed, bylineTime, count, createElement, decode, detailsFaq, faqPairs, headings, jsonLd, load, ofType,
  plain, render, sectionHtml,
} from './helpers/seo-pages-harness.mjs';

const article = load('src/components/discovery/guide-article.tsx', { guides: fixtureGuides });
const registry = load('src/lib/seo/registry.ts', { guides: fixtureGuides });
const { formatHebrewDate } = load('src/lib/seo/dates.ts');
const renderGuide = (guide) => render(createElement(article.GuideArticle, { guide }));

test('GuideArticle: one H1 with the direct answer directly under it, then byline, contents and sections', () => {
  const html = renderGuide(sampleGuide);
  assertWellFormed(html, 'sample guide', formatHebrewDate);
  assert.deepEqual(headings(html, 1), [sampleGuide.title]);
  assert.ok(html.includes('</h1><div class="ga-summary">'), 'the summary block follows the H1 immediately');
  const summary = /<div class="ga-summary"><p class="ga-summary-label">([^<]*)<\/p><p class="ga-summary-text">([^<]*)<\/p><\/div>/.exec(html);
  assert.equal(summary[1], 'בקיצור');
  assert.equal(decode(summary[2]), sampleGuide.summary);
  assertInOrder(html, [
    '<h1>', 'class="ga-summary"', 'class="ga-byline"', 'class="ga-toc"', `<section id="${sampleGuide.sections[0].id}"`,
    'id="faq-heading"', 'class="ga-actions"', 'id="article-sources"', 'role="note"', 'id="article-related"',
  ]);
  assert.match(html, /מאת <span class="ga-author">צוות Freelance Place<\/span>/);
  assert.equal(count(html, /<article/g), 1);
  assert.equal(count(html, /<\/article>/g), 1);
});

test('GuideArticle: the visible <time> is the modified date, never the published date', () => {
  const html = renderGuide(sampleGuide);
  assert.notEqual(sampleGuide.published, sampleGuide.modified, 'the fixture distinguishes the two dates');
  assert.deepEqual(bylineTime(html), { iso: sampleGuide.modified, shown: formatHebrewDate(sampleGuide.modified) });
  assert.doesNotMatch(html, new RegExp(`dateTime="${sampleGuide.published}"`));
  assert.match(html, /עודכן ב־<time dateTime="2026-11-09">9 בנובמבר 2026<\/time>/);
});

test('GuideArticle: every section is a <section id> with an H2, the answer as lead, then paragraphs, list and table in order', () => {
  const html = renderGuide(sampleGuide);
  for (const section of sampleGuide.sections) {
    const block = sectionHtml(html, section.id);
    assert.ok(block.startsWith(`<section id="${section.id}" class="ga-section" aria-labelledby="${section.id}-heading">`));
    assert.deepEqual(headings(block, 2), [section.heading]);
    assert.ok(block.includes(`<h2 id="${section.id}-heading">`));
    const answer = /<p class="ga-answer">([\s\S]*?)<\/p>/.exec(block);
    assert.equal(decode(answer[1]), section.answer);
    assert.equal(block.indexOf('<p class="ga-answer">'), block.indexOf('</h2>') + '</h2>'.length, 'the answer is the first thing after the heading');
    assert.deepEqual([...block.matchAll(/<p>([\s\S]*?)<\/p>/g)].map((m) => decode(m[1])), section.paragraphs ?? []);
    const markers = ['<h2', 'class="ga-answer"', section.paragraphs?.length ? '<p>' : null, section.list ? 'class="ga-list"' : null, section.table ? 'discovery-table' : null].filter(Boolean);
    assertInOrder(block, markers, `section ${section.id}`);
    if (section.list) {
      const tag = section.list.ordered ? 'ol' : 'ul';
      const list = new RegExp(`<${tag} class="ga-list">([\\s\\S]*?)</${tag}>`).exec(block);
      assert.ok(list, `${section.id} uses <${tag}>`);
      assert.deepEqual([...list[1].matchAll(/<li>([\s\S]*?)<\/li>/g)].map((m) => decode(m[1])), section.list.items);
    } else assert.doesNotMatch(block, /ga-list/);
  }
});

test('GuideArticle: ordered and unordered lists keep their meaning', () => {
  const html = renderGuide(sampleGuide);
  assert.ok(sectionHtml(html, 'define-goal').includes('<ol class="ga-list">'));
  assert.ok(sectionHtml(html, 'red-flags').includes('<ul class="ga-list">'));
});

test('GuideArticle: a table has a caption, column headers, row headers and data labels, in the existing responsive wrapper', () => {
  const html = renderGuide(sampleGuide);
  const { table } = sampleGuide.sections[1];
  const block = sectionHtml(html, 'compare-quotes');
  assert.equal(count(block, /<table>/g), 1);
  assert.ok(block.includes('<div class="discovery-table ga-table">'), 'reuses the .discovery-table styles that stack cells on narrow screens');
  assert.equal(decode(/<caption>([\s\S]*?)<\/caption>/.exec(block)[1]), table.caption);
  assert.deepEqual([...block.matchAll(/<th scope="col">([^<]*)<\/th>/g)].map((m) => decode(m[1])), table.columns);
  assertInOrder(block, ['<caption>', '<thead>', '<tbody>']);
  const rows = [.../<tbody>([\s\S]*?)<\/tbody>/.exec(block)[1].matchAll(/<tr>([\s\S]*?)<\/tr>/g)].map((m) => m[1]);
  assert.equal(rows.length, table.rows.length);
  rows.forEach((row, index) => {
    assert.deepEqual([...row.matchAll(/<th scope="row">([\s\S]*?)<\/th>/g)].map((m) => decode(m[1])), [table.rows[index][0]], 'the first cell names the row');
    assert.deepEqual([...row.matchAll(/<td data-label="([^"]*)">([\s\S]*?)<\/td>/g)].map((m) => [decode(m[1]), decode(m[2])]), table.rows[index].slice(1).map((cell, cellIndex) => [table.columns[cellIndex + 1], cell]));
  });
});

test('GuideArticle: a table without columns or rows is not rendered, and a section needs nothing beyond its answer', () => {
  const sections = [
    { id: 'no-rows', heading: 'ללא שורות', answer: 'תשובה קצרה וישירה שפותחת את החלק ועומדת בפני עצמה.', table: { caption: 'טבלה ריקה', columns: ['א', 'ב'], rows: [] } },
    { id: 'no-cols', heading: 'ללא עמודות', answer: 'תשובה קצרה וישירה שפותחת את החלק ועומדת בפני עצמה.', table: { caption: 'טבלה ריקה', columns: [], rows: [['x']] } },
    { id: 'answer-only', heading: 'תשובה בלבד', answer: 'תשובה קצרה וישירה שפותחת את החלק ועומדת בפני עצמה.' },
    { id: 'empty-list', heading: 'רשימה ריקה', answer: 'תשובה קצרה וישירה שפותחת את החלק ועומדת בפני עצמה.', list: { items: [] } },
  ];
  const html = render(createElement(article.GuideSections, { sections }));
  assert.equal(count(html, /<section /g), 4);
  assert.doesNotMatch(html, /<table|<ul|<ol/);
  assert.equal(count(html, /class="ga-answer"/g), 4);
});

test('GuideArticle: contents link to every section, the FAQ and the sources, and only when there is something to navigate', () => {
  const html = renderGuide(sampleGuide);
  const toc = /<nav class="ga-toc"[\s\S]*?<\/nav>/.exec(html)[0];
  assert.deepEqual([...toc.matchAll(/href="#([^"]+)"/g)].map((m) => m[1]), [...sampleGuide.sections.map((s) => s.id), 'faq-heading', 'article-sources']);
  assert.deepEqual([...toc.matchAll(/<a href="#[^"]+">([\s\S]*?)<\/a>/g)].map((m) => decode(m[1])), [...sampleGuide.sections.map((s) => s.heading), 'שאלות ותשובות', 'מקורות']);
  assert.ok(toc.includes('aria-labelledby="article-toc-title"'));
  const few = render(createElement(article.PageContents, { items: [{ id: 'a', label: 'א' }, { id: 'b', label: 'ב' }] }));
  assert.equal(few, '', 'two entries are not worth a contents block');
});

test('GuideArticle: the FAQ is visible and the FAQPage markup carries identical text', () => {
  const html = renderGuide(sampleGuide);
  const faqNodes = ofType(html, 'FAQPage');
  assert.equal(faqNodes.length, 1, 'one FAQPage');
  const visible = detailsFaq(html);
  assert.deepEqual(visible, sampleGuide.faq.map((item) => [item.question, item.answer]));
  assert.deepEqual(faqPairs(faqNodes[0]), visible, 'structured data text equals the visible text, special characters included');
  const script = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(html.slice(html.indexOf('id="faq-heading"')))[1];
  assert.doesNotMatch(script, /<|>/, 'script delimiters are escaped inside JSON-LD');
});

test('GuideArticle: sources list the name, an https link and the check date; other URLs stay plain text', () => {
  const html = renderGuide(sampleGuide);
  const block = sectionHtml(html, 'article-sources');
  assert.deepEqual(headings(block, 2), ['מקורות']);
  const items = [...block.matchAll(/<li>([\s\S]*?)<\/li>/g)].map((m) => m[1]);
  assert.equal(items.length, sampleGuide.sources.length);
  assert.ok(items[0].includes('href="https://example.com/public-page"'));
  assert.ok(items[0].includes('rel="external"'));
  assert.ok(items[0].includes('>דף ציבורי לדוגמה</a>'));
  assert.ok(items[0].includes('נבדק ב־<time dateTime="2026-11-09">9 בנובמבר 2026</time>'));
  assert.doesNotMatch(items[1], /<a /, 'a javascript: URL is never turned into a link');
  assert.ok(items[1].includes('מקור עם קישור לא תקין'));
  assert.ok(items[1].includes('<time dateTime="2026-11-08">8 בנובמבר 2026</time>'));
  assert.doesNotMatch(html, /javascript:/);
});

test('GuideArticle: the disclaimer is a visible note', () => {
  const html = renderGuide(sampleGuide);
  const note = /<div class="ga-disclaimer" role="note">([\s\S]*?)<\/div>/.exec(html);
  assert.ok(note, 'note present');
  assert.equal(visibleText(note[1]), `הבהרה: ${sampleGuide.disclaimer}`);
});

test('GuideArticle: related reading uses registry titles and skips unknown and own pages and repeats', () => {
  const html = renderGuide(sampleGuide);
  const block = sectionHtml(html, 'article-related');
  assert.deepEqual(headings(block, 2), ['קריאה נוספת']);
  const links = [...block.matchAll(/<li><a href="([^"]+)">([\s\S]*?)<\/a><\/li>/g)].map((m) => [m[1], decode(m[2])]);
  assert.deepEqual(links, [
    ['/guides/project-brief', registry.pageByPath('/guides/project-brief').title],
    ['/categories/design', registry.pageByPath('/categories/design').title],
  ]);
  assert.equal(registry.pageByPath('/missing-page'), undefined);
});

test('relatedLinks also skips pages that are not indexable', () => {
  const pages = { '/a': { title: 'A', indexable: true }, '/b': { title: 'B', indexable: false }, '/c': { title: 'C' } };
  const stubbed = load('src/components/discovery/guide-article.tsx', { stubs: { '@/lib/seo/registry': { pageByPath: (path) => pages[path] } } });
  assert.deepEqual(plain(stubbed.relatedLinks(['/a', '/b', '/c', '/d', '/a', '/self'], '/self')), [{ path: '/a', title: 'A' }, { path: '/c', title: 'C' }]);
  assert.equal(render(createElement(stubbed.RelatedReading, { paths: ['/b', '/d'], current: '/self' })), '', 'no empty "related reading" heading');
});

test('GuideArticle: author text is escaped, never interpreted as markup', () => {
  const html = renderGuide(sampleGuide);
  assert.ok(html.includes('&lt;b&gt;מודגש&lt;/b&gt; &amp; &quot;מירכאות&quot;'));
  assert.equal(documentFor(html).querySelectorAll('b').length, 0);
  assert.ok(html.includes('Figma-component-library-handover-checklist-version-final-approved-2026'), 'long Latin tokens render as text');
});

test('GuideArticle: a minimal guide renders no empty optional blocks', () => {
  const html = renderGuide(bareGuide);
  assertWellFormed(html, 'bare guide', formatHebrewDate);
  assert.doesNotMatch(html, /ga-sources|ga-disclaimer|ga-related|<table|ga-list|role="note"/);
  assert.equal(count(html, /<section id="/g), bareGuide.sections.length + 0, 'only the four content sections carry an id');
  assert.equal(ofType(html, 'FAQPage').length, 1);
  assert.equal(detailsFaq(html).length, bareGuide.faq.length);
});

test('GuideArticle: the closing call to action follows the audience', () => {
  const cta = (guide) => [...renderGuide(guide).matchAll(/<a href="([^"]+)" class="(discovery-cta|ga-secondary)">([^<]*)<\/a>/g)].map((m) => [m[1], m[2]]);
  assert.deepEqual(cta(sampleGuide), [['/projects/new', 'discovery-cta']], 'clients');
  assert.deepEqual(cta(bareGuide), [['/', 'discovery-cta']], 'freelancers');
  assert.deepEqual(cta(bothGuide), [['/projects/new', 'discovery-cta'], ['/', 'ga-secondary']], 'both');
});

test('InfoArticle shares the guide section renderer and keeps the same block order', () => {
  const content = infoContent('כותרת לדוגמה');
  const marker = createElement('aside', { id: 'page-block' }, 'x');
  const html = render(createElement(article.InfoArticle, { content, path: '/pricing', modified: '2026-11-10', afterSections: marker, actions: [article.articleActions.postProject, article.articleActions.browseProjects] }));
  assertWellFormed(html, 'info article', formatHebrewDate);
  assert.ok(html.includes(render(createElement(article.GuideSections, { sections: content.sections }))), 'sections are rendered by GuideSections, byte for byte');
  assertInOrder(html, ['<h1>', 'class="ga-summary"', 'class="ga-byline"', 'class="ga-toc"', '<section id="first"', 'id="page-block"', 'id="faq-heading"', 'class="ga-actions"', 'id="article-related"']);
  assert.deepEqual(bylineTime(html), { iso: '2026-11-10', shown: '10 בנובמבר 2026' });
  assert.deepEqual(detailsFaq(html), content.faq.map((item) => [item.question, item.answer]));
  const links = [...sectionHtml(html, 'article-related').matchAll(/<li><a href="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(links, ['/', '/guides', '/faq'], 'unknown paths are skipped and the page does not link to itself');
});

test('InfoArticle copes with empty optional fields', () => {
  const content = { ...infoContent('כותרת לדוגמה'), faq: [], related: [], summary: '' };
  const html = render(createElement(article.InfoArticle, { content, path: '/about' }));
  assert.equal(count(html, /<h1[ >]/g), 1);
  assert.doesNotMatch(html, /ga-summary|faq-heading|<details|ga-related|ga-actions|<time/);
  assert.equal(ofType(html, 'FAQPage').length, 0, 'no empty FAQPage is emitted');
  assert.equal(jsonLd(html).length, 0);
  assert.match(html, /מאת <span class="ga-author">צוות Freelance Place<\/span>/, 'the byline stays, without a date');
});

test('Breadcrumbs link every level but the current page, which is marked', () => {
  const crumbs = load('src/components/discovery/breadcrumbs.tsx');
  const items = [{ name: 'דף הבית', path: '/' }, { name: 'מדריכים', path: '/guides' }, { name: 'מדריך', path: '/guides/x' }];
  // Guide and information pages style the trail as ga-crumbs and emit their own BreadcrumbList.
  const html = render(createElement(crumbs.Breadcrumbs, { items, structured: false, className: 'ga-crumbs' }));
  assert.equal(html, '<nav class="ga-crumbs" aria-label="פירורי לחם"><ol><li><a href="/">דף הבית</a></li><li><a href="/guides">מדריכים</a></li><li><span aria-current="page">מדריך</span></li></ol></nav>');
  // By default the same items also produce the BreadcrumbList, so the visible trail and the markup cannot differ.
  const withData = render(createElement(crumbs.Breadcrumbs, { items }));
  assert.match(withData, /^<nav class="disc-crumbs"/);
  assert.deepEqual(plain(ofType(withData, 'BreadcrumbList')[0].itemListElement.map((item) => item.name)), items.map((item) => item.name));
});
