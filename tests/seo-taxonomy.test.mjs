import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { NextRequest, NextResponse } from 'next/server.js';
import { loadModule, projectRoot } from './helpers/load-ts.mjs';

// Programmatic landing pages: the skill catalogue and its matching rule, the /skills and
// /projects hubs, pagination, listing and linking rules, the category and project page upgrades
// and the 404 page. Pages are rendered through the shared loader with the data boundary stubbed.

const plain = (value) => JSON.parse(JSON.stringify(value));
const ENV = { SITE_INDEXABLE: 'true' };
const load = (entry, stubs = {}) => loadModule(entry, { stubs, env: ENV });
// The loader's default next/link and next/image stubs lack __esModule, so default imports need proper module stubs.
const ui = {
  'next/link': { __esModule: true, default: ({ href, children, prefetch, ...rest }) => createElement('a', { href, ...rest }, children) },
  'next/image': { __esModule: true, default: ({ src, alt, width, height }) => createElement('img', { src, alt, width, height }) },
};

const skillsModule = load('src/lib/seo/skills.ts');
const matching = load('src/lib/seo/skill-match.ts');
const listing = load('src/lib/seo/listing.ts');
const paging = load('src/lib/seo/pagination.ts');
const dates = load('src/lib/seo/dates.ts');
const relatedModule = load('src/lib/seo/related.ts');
const categoryPage = load('src/lib/seo/category-page.ts');
const linking = load('src/lib/seo/linking.ts');
const registry = load('src/lib/seo/registry.ts');
const { categories } = load('src/lib/seo/categories.ts');
const { AI_AGENT_BADGE } = load('src/lib/projects/presentation.ts');
// Public discovery pages never mention AI-agent or sample projects: they only ever receive a real client's projects.
const assertNoShowcaseWording = (html, label) => {
  assert.equal(html.includes(AI_AGENT_BADGE), false, `${label}: no "${AI_AGENT_BADGE}" label`);
  assert.equal(/ai-agent-badge|role="note"/.test(html), false, `${label}: no AI-agent badge or note`);
  assert.equal(/סוכן AI|פרויקט הדגמה|פרויקטי הדגמה/.test(html), false, `${label}: no showcase wording`);
};

const escapeHtml = (text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;');
const count = (html, pattern) => (html.match(pattern) ?? []).length;
const jsonLd = (html) => [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((match) => JSON.parse(match[1]));
const nodesOfType = (html, type) => jsonLd(html).filter((node) => node['@type'] === type);
const nodeOfType = (html, type) => nodesOfType(html, type)[0];
const NOT_FOUND = { digest: 'NEXT_NOT_FOUND' };
const params = (slug) => ({ params: Promise.resolve({ slug }) });
const search = (query) => ({ searchParams: Promise.resolve(query) });

const NOW = Date.UTC(2026, 10, 9, 12, 0, 0);
const agent = { sample: true, ownerKind: 'ai-agent' };
const project = (n, extra = {}) => ({
  slug: `project-${n}`, title: `פרויקט מספר ${n}`, category: 'פיתוח אתרים', description: `תיאור קצר של פרויקט ${n} עם פרטים על העבודה הנדרשת.`,
  budget: '₪1,000–2,000', deadline: 'גמיש', posted: 'פרויקט חדש', client: 'לקוח לדוגמה', clientHistory: 'לקוח חדש', skills: [], fit: 80, activity: '', proposals: 0,
  createdAt: NOW - n * 3_600_000, ...extra,
});
const projectsData = (list, detail = {}) => ({ '@/lib/seo/projects': { discoveryProjects: async () => list, readPublicProject: async (slug) => detail[slug] ?? list.find((item) => item.slug === slug) ?? null } });

// A catalogue built from synthetic skills: the real skills module and registry loaded over stubbed data modules.
const wordpress = skillsModule.skillBySlug('wordpress');
const synthetic = (slug, overrides = {}) => ({ ...plain(wordpress), slug, name: `כישור ${slug}`, title: `כותרת בדיקה עבור ${slug}`, aliases: [slug], related: [], guides: [], published: '2026-11-01', modified: '2026-11-02', ...overrides });
function catalogue(list) {
  const skills = load('src/lib/seo/skills.ts', {
    './skill-data/web-development': { webDevelopmentSkills: list },
    './skill-data/design': { designSkills: [] },
    './skill-data/writing-marketing': { writingMarketingSkills: [] },
    './skill-data/video-animation': { videoAnimationSkills: [] },
  });
  const registryStub = load('src/lib/seo/registry.ts', { './skills': skills });
  return { skills, registry: registryStub, stubs: { './skills': skills, '@/lib/seo/skills': skills, './registry': registryStub, '@/lib/seo/registry': registryStub } };
}

// ---- catalogue, gate and matching rule -------------------------------------------------------

test('the catalogue aggregates the four skill data modules in category order and its helpers resolve skills', () => {
  const { skills, skillBySlug, skillsByCategory, indexableSkills } = skillsModule;
  const parts = [
    load('src/lib/seo/skill-data/web-development.ts').webDevelopmentSkills, load('src/lib/seo/skill-data/design.ts').designSkills,
    load('src/lib/seo/skill-data/writing-marketing.ts').writingMarketingSkills, load('src/lib/seo/skill-data/video-animation.ts').videoAnimationSkills,
  ].flat();
  assert.ok(skills.length > 0);
  assert.deepEqual(plain(skills.map((skill) => skill.slug)), parts.map((skill) => skill.slug));
  assert.equal(new Set(skills.map((skill) => skill.slug)).size, skills.length);
  for (const skill of skills) {
    assert.equal(skillBySlug(skill.slug), skill);
    assert.ok(skillsByCategory(skill.category).includes(skill));
  }
  for (const slug of ['', 'nope', '__proto__', 'WordPress']) assert.equal(skillBySlug(slug), undefined, slug);
  assert.deepEqual(plain(skillsByCategory('no-such-category')), []);
  assert.ok(indexableSkills().includes(skillBySlug('wordpress')), 'the reference entry passes the gate');
  assert.ok(registry.indexablePages().some((page) => page.path === '/skills/wordpress'));
});

test('the quality gate keeps thin skill pages noindex, out of the sitemap and unlinked', async () => {
  const thin = synthetic('thin-skill', { deliverables: ['one'], modified: '2026-12-01', published: '2026-12-01' });
  const full = synthetic('full-skill', { modified: '2026-11-05' });
  const env = catalogue([full, thin]);
  assert.equal(env.skills.isIndexableSkill(thin), false);
  assert.deepEqual(plain(env.skills.indexableSkills().map((skill) => skill.slug)), ['full-skill']);
  const all = env.registry.allPages().map((page) => page.path);
  const listed = env.registry.indexablePages().map((page) => page.path);
  assert.ok(all.includes('/skills/thin-skill') && !listed.includes('/skills/thin-skill'));
  assert.ok(listed.includes('/skills/full-skill') && listed.includes('/skills'));
  assert.equal(env.registry.requirePage('/skills').modified, '2026-11-05', 'the hub date follows the listed skills, never a thin one');

  const skillPage = load('src/app/skills/[slug]/page.tsx', { ...ui, ...projectsData([]), ...env.stubs });
  assert.equal((await skillPage.generateMetadata(params('thin-skill'))).robots.index, false);
  const fullMeta = await skillPage.generateMetadata(params('full-skill'));
  assert.equal(fullMeta.robots.index, true);
  assert.equal(fullMeta.alternates.canonical, 'https://freelance-place.com/skills/full-skill');

  const hub = load('src/app/skills/page.tsx', { ...ui, ...env.stubs });
  const html = renderToStaticMarkup(hub.default());
  assert.ok(html.includes('href="/skills/full-skill"'));
  assert.equal(html.includes('thin-skill'), false);
  assert.deepEqual(plain(nodeOfType(html, 'CollectionPage').mainEntity.itemListElement.map((item) => item.url)), ['https://freelance-place.com/skills/full-skill']);
  assert.equal(hub.metadata.robots.index, true);

  const cards = load('src/components/discovery/project-cards.tsx', { ...ui, ...env.stubs });
  const chips = renderToStaticMarkup(cards.ProjectCardList({ projects: [project(1, { skills: ['full-skill', 'thin-skill', 'Other'] })] }));
  assert.ok(chips.includes('<a href="/skills/full-skill" class="disc-chip">full-skill</a>'));
  assert.ok(chips.includes('<span class="disc-chip">thin-skill</span>'), 'a skill that fails the gate is plain text');
  assert.ok(chips.includes('<span class="disc-chip">Other</span>'));
});

test('with no complete skill the /skills hub is noindex, unlisted and shows an honest empty state', () => {
  const env = catalogue([synthetic('only-thin', { deliverables: [] })]);
  assert.equal(env.registry.requirePage('/skills').indexable, false);
  assert.equal(env.registry.indexablePages().some((page) => page.path === '/skills'), false);
  const hub = load('src/app/skills/page.tsx', { ...ui, ...env.stubs });
  assert.equal(hub.metadata.robots.index, false);
  const html = renderToStaticMarkup(hub.default());
  assert.match(html, /class="disc-empty"/);
  assert.equal(html.includes('only-thin'), false);
  assert.equal(count(html, /class="disc-skill-grid"/g), 0);
});

test('matching rule: an alias equals a project skill, or a Latin alias of 3+ letters is a whole word of the title', () => {
  const skill = synthetic('x', { aliases: ['WordPress', 'וורדפרס', 'WP', 'Next.js', 'After Effects'] });
  const matches = (project) => matching.skillMatchesProject(skill, { title: '', skills: [], ...project });
  // Equality with one of the project's own skills ignores case, spacing and Unicode form.
  for (const tag of ['WordPress', 'wordpress', '  WORDPRESS  ', 'וורדפרס', 'wp', 'next.js', 'after   effects']) assert.equal(matches({ skills: [tag] }), true, tag);
  assert.equal(matching.skillMatchesProject(synthetic('cafe', { aliases: ['Café'] }), { title: '', skills: ['Café'] }), true, 'canonically equivalent Unicode forms match');
  assert.equal(matches({ skills: ['Word'] }), false);
  assert.equal(matches({ skills: ['WordPress Plugin'] }), false, 'a tag must equal an alias, not contain it');
  // A Latin alias counts as a whole word of the title: Hebrew letters and punctuation are boundaries.
  for (const title of ['אתר ב־WordPress לסטודיו', 'wordpress developer', 'Migrating WordPress.', '(WordPress)', 'שדרוג Next.js', 'פיתוח ב־WORDPRESS', 'ריענון wordpressים', 'סרטון ב־After Effects']) assert.equal(matches({ title }), true, title);
  for (const title of ['WordPressify theme', 'MyWordPress', 'WordPress2', 'WordPress_pro', 'Next.jsx', 'After Effectsx']) assert.equal(matches({ title }), false, title);
  // Short and Hebrew aliases never match a title; the category alone never matches.
  assert.equal(matches({ title: 'בניית אתר WP' }), false);
  assert.equal(matches({ title: 'אתר וורדפרס לעסק' }), false);
  assert.equal(matches({ title: 'אתר תדמית', category: 'פיתוח אתרים' }), false);
  assert.equal(matching.skillMatchesProject({ ...skill, aliases: [] }, { title: 'WordPress', skills: ['WordPress'] }), false);
  assert.equal(matching.skillMatchesProject({ ...skill, aliases: ['', '  '] }, { title: 'WordPress', skills: [''] }), false);
});

test('title aliases need three Latin letters and no Hebrew', () => {
  for (const alias of ['SEO', 'Figma', 'Web3', 'Next.js', 'After Effects', 'UX/UI']) assert.equal(matching.isTitleAlias(alias), true, alias);
  for (const alias of ['WP', 'UX', 'C++', 'וורדפרס', 'SEO קידום', '123', '']) assert.equal(matching.isTitleAlias(alias), false, alias);
  assert.equal(matching.containsWholeWord('a seo b', 'seo'), true);
  assert.equal(matching.containsWholeWord('seoul', 'seo'), false);
  assert.equal(matching.containsWholeWord('xseo seo', 'seo'), true, 'a later whole-word occurrence still matches');
  assert.equal(matching.containsWholeWord('anything', ''), false);
});

test('projectsForSkill keeps the given order and every linked tag is a project the skill page lists', () => {
  const figma = synthetic('figma', { aliases: ['Figma', 'פיגמה'] });
  const other = synthetic('sketch', { aliases: ['Sketch'] });
  const list = [{ slug: 'a', title: 'עיצוב ב־Figma', skills: [] }, { slug: 'b', title: 'לוגו', skills: ['פיגמה'] }, { slug: 'c', title: 'לוגו', skills: ['Sketch'] }, { slug: 'd', title: 'ממשק', skills: ['figma', 'Sketch'] }];
  assert.deepEqual(plain(matching.projectsForSkill(figma, list).map((item) => item.slug)), ['a', 'b', 'd']);
  assert.deepEqual(plain(matching.projectsForSkill(figma, [...list].reverse()).map((item) => item.slug)), ['d', 'b', 'a']);
  assert.deepEqual(plain(matching.skillsForProject(list[3], [figma, other]).map((item) => item.slug)), ['figma', 'sketch']);
  const tags = matching.projectSkillTags({ skills: ['figma', 'Figma', ' FIGMA ', 'Photoshop', ''] }, [figma, other]);
  assert.deepEqual(plain(tags.map((entry) => [entry.tag, entry.skill?.slug ?? null])), [['figma', 'figma'], ['Photoshop', null]]);
  assert.equal(matching.skillForTag('SKETCH', [figma, other]).slug, 'sketch');
  assert.equal(matching.skillForTag('  ', [figma, other]), undefined);
  for (const item of list) for (const entry of matching.projectSkillTags(item, [figma, other])) {
    if (entry.skill) assert.equal(matching.skillMatchesProject(entry.skill, item), true, `${item.slug}/${entry.tag}`);
  }
});

// ---- hubs and sitemap ------------------------------------------------------------------------

test('the /skills and /projects hubs are registered with their routes and meet the registry contract', async () => {
  for (const [path, section] of [['/skills', 'Skills'], ['/projects', 'Product']]) {
    const page = registry.requirePage(path);
    assert.equal(page.kind, 'hub', path);
    assert.ok(page.title.length >= 20 && page.title.length <= 60, `${path} title length ${page.title.length}`);
    assert.ok(page.description.length >= 70 && page.description.length <= 165, `${path} description length ${page.description.length}`);
    assert.equal(page.llms.section, section, path);
    assert.ok(existsSync(`${projectRoot}/src/app${path}/page.tsx`), `${path} has its route`);
  }
  const route = load('src/app/sitemap.ts', { '@/lib/seo/projects': { sitemapProjects: async () => [{ slug: 'real-project' }] } });
  const urls = (await route.default()).map((entry) => entry.url);
  for (const path of ['/skills', '/projects', '/projects/real-project']) assert.equal(urls.filter((url) => url === `https://freelance-place.com${path}`).length, 1, path);
  assert.equal(urls.some((url) => url.includes('?')), false, 'pagination URLs are discovered through links, not listed in the sitemap');
});

// ---- pagination ------------------------------------------------------------------------------

test('parsePageParam accepts only plain positive integers and treats a missing value as page 1', () => {
  assert.equal(paging.parsePageParam(undefined), 1);
  for (const [raw, expected] of [['1', 1], ['2', 2], ['10', 10], ['9999999', 9999999]]) assert.equal(paging.parsePageParam(raw), expected, raw);
  for (const raw of ['0', '-1', '01', '1.5', '1e3', 'abc', '', ' 2', '2 ', '+2', '10000000', ['1', '2'], []]) assert.equal(paging.parsePageParam(raw), undefined, JSON.stringify(raw));
});

test('paginate slices in memory with a fixed size; an empty list has one page and out-of-range pages are undefined', () => {
  const items = Array.from({ length: 30 }, (_, index) => index + 1);
  assert.equal(paging.PROJECTS_PAGE_SIZE, 12);
  const first = paging.paginate(items, 1);
  assert.deepEqual(plain({ ...first, items: first.items.length }), { items: 12, page: 1, totalPages: 3, total: 30, size: 12, from: 1, to: 12 });
  assert.deepEqual(plain(paging.paginate(items, 3).items), [25, 26, 27, 28, 29, 30]);
  assert.deepEqual(plain({ from: paging.paginate(items, 3).from, to: paging.paginate(items, 3).to }), { from: 25, to: 30 });
  assert.equal(paging.paginate(items.slice(0, 24), 2).totalPages, 2, 'an exact multiple adds no empty page');
  assert.equal(paging.paginate(items.slice(0, 24), 3), undefined);
  for (const page of [0, 4, -1, 1.5, Number.NaN]) assert.equal(paging.paginate(items, page), undefined, String(page));
  assert.deepEqual(plain(paging.paginate([], 1)), { items: [], page: 1, totalPages: 1, total: 0, size: 12, from: 0, to: 0 });
  assert.equal(paging.paginate([], 2), undefined);
  assert.deepEqual(plain(paging.paginate(items, 2, 10).items), items.slice(10, 20));
  assert.equal(paging.projectsPagePath(0), '/projects');
  assert.equal(paging.projectsPagePath(1), '/projects');
  assert.equal(paging.projectsPagePath(2), '/projects?page=2');
});

test('pageWindow lists the first, last, current and neighbouring pages with gaps marked', () => {
  const window = (page, total) => plain(paging.pageWindow(page, total));
  assert.deepEqual(window(1, 1), [1]);
  assert.deepEqual(window(1, 3), [1, 2, 3]);
  assert.deepEqual(window(1, 5), [1, 2, null, 5]);
  assert.deepEqual(window(3, 10), [1, 2, 3, 4, null, 10]);
  assert.deepEqual(window(4, 10), [1, 2, 3, 4, 5, null, 10], 'a gap of one page shows its number');
  assert.deepEqual(window(5, 10), [1, null, 4, 5, 6, null, 10]);
  assert.deepEqual(window(10, 10), [1, null, 9, 10]);
});

// ---- listing, counts and dates ---------------------------------------------------------------

test('listing: order is newest first with a slug tie-break, and the listing rules know nothing about AI-agent projects', () => {
  for (const removed of ['isAiAgentProject', 'isPublicProject', 'publicProjects', 'countAiAgentProjects']) assert.equal(listing[removed], undefined, `${removed} is gone: lists receive discoverable projects only`);
  const input = [{ slug: 'old', createdAt: 1 }, { slug: 'b-tie', createdAt: 5 }, { slug: 'none' }, { slug: 'a-tie', createdAt: 5 }, { slug: 'new', createdAt: 9 }];
  const snapshot = input.map((item) => item.slug);
  assert.deepEqual(plain(listing.sortNewestFirst(input).map((item) => item.slug)), ['new', 'a-tie', 'b-tie', 'old', 'none']);
  assert.deepEqual(input.map((item) => item.slug), snapshot, 'the input is not mutated');
  assert.equal(listing.projectPath('a b/ç'), '/projects/a%20b%2F%C3%A7');
});

test('count sentences state real numbers and say nothing for zero', () => {
  const place = { one: 'בתחום הזה', many: 'בתחומים האלה' };
  const sentence = (total) => listing.projectCountSentence(total, place);
  assert.equal(sentence(1), 'כרגע יש פרויקט פתוח אחד בתחום הזה.');
  assert.equal(sentence(2), 'כרגע יש שני פרויקטים פתוחים בתחומים האלה.');
  assert.equal(sentence(3), 'כרגע יש 3 פרויקטים פתוחים בתחומים האלה.');
  for (const total of [0, -1, Number.NaN, 1.5]) assert.equal(sentence(total), undefined, String(total));
  const range = (from, to, total) => listing.projectRangeSentence(from, to, total);
  assert.equal(range(13, 24, 30), 'מוצגים 13–24 מתוך 30 פרויקטים פתוחים.');
  assert.equal(range(1, 12, 30), 'מוצגים 1–12 מתוך 30 פרויקטים פתוחים.');
  assert.equal(range(2, 2, 13), 'מוצג פרויקט 2 מתוך 13 פרויקטים פתוחים.');
  assert.equal(range(1, 1, 1), 'מוצג פרויקט 1 מתוך 1 פרויקט פתוח.');
  assert.equal(range(0, 0, 0), undefined);
  for (const text of [sentence(3), range(13, 24, 30)]) assert.doesNotMatch(text, /מסומנ|AI/, 'no share of labelled projects is ever disclosed');
});

test('Hebrew dates are written out without ICU data and the Israeli calendar day is used for timestamps', () => {
  assert.equal(dates.formatHebrewDate('2026-11-10'), '10 בנובמבר 2026');
  assert.equal(dates.formatHebrewDate('2026-01-05'), '5 בינואר 2026');
  assert.equal(dates.formatHebrewDate('2026-12-31'), '31 בדצמבר 2026');
  for (const value of ['2026-02-30', '2026-13-01', '2026-00-10', '2026-11-00', '26-11-10', '2026-11-10T00:00:00Z', '', 'abc']) assert.equal(dates.formatHebrewDate(value), value, value);
  assert.equal(dates.israelDate(Date.UTC(2026, 10, 9, 12, 0)), '2026-11-09');
  assert.equal(dates.israelDate(Date.UTC(2026, 10, 9, 22, 30)), '2026-11-10', 'winter time is UTC+2');
  assert.equal(dates.israelDate(Date.UTC(2026, 6, 9, 21, 30)), '2026-07-10', 'summer time is UTC+3');
  for (const value of [undefined, Number.NaN, Number.POSITIVE_INFINITY, '5']) assert.equal(dates.israelDate(value), undefined, String(value));
});

// ---- related projects, linking and category FAQ ----------------------------------------------

test('related projects: same category or a shared skill, most relevant first, deterministic, never the project itself', () => {
  const item = (slug, category, skills, createdAt) => ({ slug, category, skills, createdAt });
  const self = item('self', 'פיתוח אתרים', ['WordPress', 'Figma'], 100);
  const candidates = [
    item('both-old', 'פיתוח אתרים', ['wordpress'], 10), item('both-new', 'פיתוח אתרים', ['WORDPRESS', 'Figma'], 50),
    item('cat-new', 'פיתוח אתרים', ['React'], 90), item('cat-old', 'תכנות ופיתוח תוכנה', [], 20),
    item('skill-only', 'כתיבה ועריכה', ['figma'], 80), item('unrelated', 'וידאו ואנימציה', ['Premiere'], 99),
    item('self', 'פיתוח אתרים', ['WordPress'], 5), item('both-old', 'פיתוח אתרים', ['wordpress'], 10),
  ];
  const slugs = (list) => plain(list.map((entry) => entry.slug));
  const expected = ['both-new', 'both-old', 'cat-new', 'cat-old', 'skill-only'];
  assert.equal(relatedModule.RELATED_PROJECT_LIMIT, 6);
  assert.deepEqual(slugs(relatedModule.relatedProjects(self, candidates)), expected);
  assert.deepEqual(slugs(relatedModule.relatedProjects(self, [...candidates].reverse())), expected, 'the input order does not change the result');
  assert.deepEqual(slugs(relatedModule.relatedProjects(self, candidates, 2)), expected.slice(0, 2));
  assert.deepEqual(slugs(relatedModule.relatedProjects(self, candidates, 0)), []);
  assert.deepEqual(slugs(relatedModule.relatedProjects(self, candidates, -3)), []);
  assert.deepEqual(slugs(relatedModule.relatedProjects(self, [])), []);
  assert.deepEqual(slugs(relatedModule.relatedProjects(self, [item('unrelated', 'וידאו ואנימציה', ['Premiere'], 1)])), [], 'nothing relevant means nothing is listed');
  const many = Array.from({ length: 10 }, (_, index) => item(`p-${index}`, 'פיתוח אתרים', [], index));
  assert.equal(relatedModule.relatedProjects(self, many).length, 6);
  // Ties on relevance: the newest first, then the slug; a missing date counts as oldest; a repeated skill counts once.
  const ties = [item('b-same', 'פיתוח אתרים', [], 7), item('a-same', 'פיתוח אתרים', [], 7), item('undated', 'פיתוח אתרים', [], undefined), item('twice', 'פיתוח אתרים', ['WordPress', 'wordpress'], 1)];
  assert.deepEqual(slugs(relatedModule.relatedProjects(self, ties)), ['twice', 'a-same', 'b-same', 'undated']);
  assert.deepEqual(slugs(relatedModule.relatedProjects(item('lonely', 'לא ידוע', [], 1), [item('x', 'לא ידוע', [], 2)])), [], 'a project without a category only relates through shared skills');
});

test('guide links come from the registry only and category guides are capped', () => {
  assert.deepEqual(plain(linking.guideLinks(['project-brief', 'missing-guide', 'project-brief']).map((link) => link.path)), ['/guides/project-brief']);
  assert.deepEqual(plain(linking.guideLinks(undefined)), []);
  assert.deepEqual(plain(linking.guideLinks(['wordpress'])), [], 'a skill page is never a guide');
  const pages = [{ path: '/guides/a', kind: 'guide', title: 'A', description: '' }, { path: '/skills/a', kind: 'skill', title: 'S', description: '' }];
  assert.deepEqual(plain(linking.guideLinks(['a'], pages)), [{ slug: 'a', path: '/guides/a', title: 'A' }]);
  const guidePaths = new Set(registry.indexablePages().filter((page) => page.kind === 'guide').map((page) => page.path));
  for (const category of categories) {
    const found = linking.guidesForCategory(category.slug);
    assert.ok(found.length <= linking.MAX_CATEGORY_GUIDES, category.slug);
    for (const link of found) assert.ok(guidePaths.has(link.path), `${category.slug} -> ${link.path}`);
    assert.ok(found.some((link) => link.slug === 'project-brief'), `${category.slug} links the project brief guide`);
  }
  assert.deepEqual(plain(linking.guidesForCategory('unknown-category')), []);
  const many = Array.from({ length: 9 }, (_, index) => ({ path: `/guides/g${index}`, kind: 'guide', title: `G${index}`, description: '' }));
  assert.equal(linking.guidesForCategory('design', many).length, 0, 'slugs that are not registered are skipped');
});

test('category FAQ: the category question first, extra questions after, nothing repeated or without an answer', () => {
  const own = { question: 'שאלה ראשית?', answer: 'תשובה ראשית.' };
  const extra = [
    { question: ' שאלה שנייה? ', answer: ' תשובה שנייה. ' }, { question: 'שאלה ראשית?', answer: 'כפילות' }, { question: 'ללא תשובה?', answer: '   ' },
    { question: '', answer: 'ללא שאלה' }, null, undefined, { question: 'שאלה שלישית?', answer: 'תשובה שלישית.' }, { question: 'שאלה שנייה?', answer: 'כפילות אחרי ניקוי רווחים' },
  ];
  assert.deepEqual(plain(categoryPage.categoryFaqItems(own, extra)), [own, { question: 'שאלה שנייה?', answer: 'תשובה שנייה.' }, { question: 'שאלה שלישית?', answer: 'תשובה שלישית.' }]);
  assert.deepEqual(plain(categoryPage.categoryFaqItems(own, undefined)), [own]);
  assert.deepEqual(plain(categoryPage.categoryFaqItems(own, [])), [own]);
  assert.deepEqual(plain(categoryPage.categoryFaqItems({ question: 'ש', answer: '' }, [])), [], 'a category question without an answer is dropped');
  const { categoryQuestions } = load('src/lib/seo/category-faq.ts');
  for (const category of categories) assert.ok(categoryPage.categoryFaqItems(category, categoryQuestions[category.slug]).length >= 1, category.slug);
});

test('every category page lists at least three questions', () => {
  const { categoryQuestions } = load('src/lib/seo/category-faq.ts');
  for (const category of categories) assert.ok(categoryPage.categoryFaqItems(category, categoryQuestions[category.slug]).length >= 3, category.slug);
});

// ---- skill pages -----------------------------------------------------------------------------

test('skill page: answer first, byline with date, FAQ markup equal to its JSON-LD, sources and an honest empty project list', async () => {
  const skill = skillsModule.skillBySlug('wordpress');
  const page = load('src/app/skills/[slug]/page.tsx', { ...ui, ...projectsData([]) });
  const html = renderToStaticMarkup(await page.default(params('wordpress')));
  assert.equal(count(html, /<h1[ >]/g), 1);
  assert.ok(html.includes(`<h1>${escapeHtml(skill.name)}</h1>`));
  assert.ok(html.includes(`<strong>בקיצור:</strong> ${escapeHtml(skill.definition)}`));
  assert.ok(html.indexOf('בקיצור:') < html.indexOf(`<h2>מתי צריך ${escapeHtml(skill.name)}?</h2>`), 'the definition comes before the sections');
  assert.ok(html.includes('מאת צוות Freelance Place'));
  assert.ok(html.includes(`<time dateTime="${skill.modified}">`));
  for (const entry of [...skill.deliverables, ...skill.howToChoose, ...skill.priceDrivers]) assert.ok(html.includes(escapeHtml(entry)), entry);
  assert.equal(count(html, /<details/g), skill.questions.length);
  for (const { question } of skill.questions) assert.ok(html.includes(`<summary>${escapeHtml(question)}</summary>`), question);
  assert.deepEqual(plain(nodeOfType(html, 'FAQPage').mainEntity.map((entry) => [entry.name, entry.acceptedAnswer.text])), plain(skill.questions.map(({ question, answer }) => [question, answer])));
  assert.deepEqual(jsonLd(html).map((node) => node['@type']).sort(), ['BreadcrumbList', 'FAQPage', 'WebPage']);
  const webPage = nodeOfType(html, 'WebPage');
  assert.equal(webPage.url, 'https://freelance-place.com/skills/wordpress');
  assert.ok(String(webPage.dateModified).startsWith(skill.modified));
  assert.deepEqual(plain(nodeOfType(html, 'BreadcrumbList').itemListElement.map((entry) => entry.name)), ['דף הבית', 'כישורים', skill.name]);
  for (const source of skill.sources ?? []) assert.ok(html.includes(`<time dateTime="${source.checked}">`), `${source.name} shows its check date`);
  if (skill.disclaimer) assert.ok(html.includes(escapeHtml(skill.disclaimer)));
  assert.ok(html.includes('href="/projects/new"'));
  assert.ok(html.includes('כרגע אין באתר פרויקטים פתוחים שמסומנים בכישור הזה'));
  assert.equal(count(html, /class="disc-card"/g), 0);
  assert.equal(/כרגע יש /.test(html), false, 'no count is invented for an empty list');
  const meta = await page.generateMetadata(params('wordpress'));
  assert.equal(meta.alternates.canonical, 'https://freelance-place.com/skills/wordpress');
  assert.equal(meta.robots.index, true);
});

test('skill page lists only matching projects, newest first, with a plain count and no AI-agent wording, and caps the list', async () => {
  const skill = skillsModule.skillBySlug('wordpress');
  const alias = skill.aliases.find(matching.isTitleAlias);
  assert.ok(alias, 'the reference skill has a Latin alias');
  const list = [
    project(1, { skills: [alias] }), project(2, { title: `אתר ב־${alias} לסטודיו`, skills: [] }), project(3, { skills: ['Unrelated'] }),
    project(5, { category: skill.category, skills: [], title: 'פרויקט לפי תחום בלבד' }),
  ];
  const page = load('src/app/skills/[slug]/page.tsx', { ...ui, ...projectsData(list) });
  const html = renderToStaticMarkup(await page.default(params('wordpress')));
  assert.equal(count(html, /class="disc-card"/g), 2);
  assert.ok(html.indexOf('href="/projects/project-1"') < html.indexOf('href="/projects/project-2"'), 'newest first');
  for (const absent of ['project-3', 'project-5']) assert.equal(html.includes(`href="/projects/${absent}"`), false, `${absent} does not match`);
  assert.ok(html.includes('כרגע יש שני פרויקטים פתוחים הקשורים לכישור הזה.'));
  assertNoShowcaseWording(html, 'skill page');
  assert.equal(html.includes('כרגע אין באתר פרויקטים'), false);

  const crowded = Array.from({ length: 8 }, (_, index) => project(index + 1, { skills: [alias] }));
  const capped = renderToStaticMarkup(await load('src/app/skills/[slug]/page.tsx', { ...ui, ...projectsData(crowded) }).default(params('wordpress')));
  assert.equal(count(capped, /class="disc-card"/g), 6);
  assert.ok(capped.includes('כרגע יש 8 פרויקטים פתוחים'));
  assert.ok(capped.includes('מוצגים כאן 6 הפרויקטים האחרונים שפורסמו'));
});

test('skill page links related skills and guides only when they exist; an unknown slug is a 404 with noindex metadata', async () => {
  const main = synthetic('skill-a', { related: ['skill-b', 'skill-thin', 'skill-missing', 'skill-b', 'skill-a'], guides: ['project-brief', 'no-such-guide'] });
  const env = catalogue([main, synthetic('skill-b'), synthetic('skill-thin', { deliverables: [] })]);
  const page = load('src/app/skills/[slug]/page.tsx', { ...ui, ...projectsData([]), ...env.stubs });
  const html = renderToStaticMarkup(await page.default(params('skill-a')));
  assert.equal(count(html, /href="\/skills\/skill-b"/g), 1);
  for (const absent of ['skill-thin', 'skill-missing', 'no-such-guide']) assert.equal(html.includes(absent), false, absent);
  assert.ok(html.includes('href="/guides/project-brief"'));
  await assert.rejects(page.default(params('nope')), NOT_FOUND);
  const meta = await page.generateMetadata(params('nope'));
  assert.equal(meta.robots.index, false);
  assert.equal(meta.title, 'הכישור לא נמצא');
});

test('skills hub: answer first, grouped by category and CollectionPage JSON-LD equal to the visible list', () => {
  const hub = load('src/app/skills/page.tsx', ui);
  const html = renderToStaticMarkup(hub.default());
  const listed = skillsModule.indexableSkills();
  assert.equal(count(html, /<h1[ >]/g), 1);
  assert.ok(html.includes('<h1>כישורים ושירותי פרילנסרים</h1>'));
  assert.ok(html.includes('<strong>בקיצור:</strong>'));
  for (const skill of listed) assert.ok(html.includes(`<a href="/skills/${skill.slug}">${escapeHtml(skill.name)}</a>`), skill.slug);
  assert.equal(count(html, /<li><h3>/g), listed.length);
  const collection = nodeOfType(html, 'CollectionPage');
  assert.deepEqual(plain(collection.mainEntity.itemListElement.map((entry) => entry.url)), plain(listed.map((skill) => `https://freelance-place.com/skills/${skill.slug}`)));
  assert.deepEqual(jsonLd(html).map((node) => node['@type']).sort(), ['BreadcrumbList', 'CollectionPage']);
  assert.equal(hub.metadata.alternates.canonical, 'https://freelance-place.com/skills');
});

// ---- project index ---------------------------------------------------------------------------

const indexList = () => Array.from({ length: 30 }, (_, index) => project(index + 1, { skills: index % 2 ? ['WordPress'] : ['Obscure'] }));
const projectsIndex = (list = indexList()) => load('src/app/projects/page.tsx', { ...ui, ...projectsData(list) });
const renderIndex = async (page, query) => renderToStaticMarkup(await page.default(search(query)));

test('project index page 1: canonical /projects, newest first, crawlable cards, pager and structured data', async () => {
  const page = projectsIndex();
  for (const query of [{}, { page: '1' }]) {
    const meta = await page.generateMetadata(search(query));
    assert.equal(meta.alternates.canonical, 'https://freelance-place.com/projects', JSON.stringify(query));
    assert.equal(meta.robots.index, true);
    const html = await renderIndex(page, query);
    assert.ok(html.includes('<h1>פרויקטים פתוחים לפרילנסרים</h1>'));
    assert.equal(count(html, /class="disc-card"/g), 12);
    const titles = Array.from({ length: 12 }, (_, index) => html.indexOf(`>פרויקט מספר ${index + 1}</a>`));
    assert.ok(titles.every((position, index) => position > 0 && (index === 0 || position > titles[index - 1])), 'projects 1..12 in newest-first order');
    assert.equal(html.includes('>פרויקט מספר 13</a>'), false);
    assert.equal(count(html, /href="\/projects\/project-\d+"/g), 12, 'every card title is a real link');
    assert.ok(html.includes('מוצגים 1–12 מתוך 30 פרויקטים פתוחים.'));
    assertNoShowcaseWording(html, 'project index');
    assert.ok(html.includes('<a href="/projects?page=2" rel="next"'));
    assert.equal(html.includes('rel="prev"'), false);
    assert.ok(html.includes('aria-current="page"'));
    const collection = nodeOfType(html, 'CollectionPage');
    assert.deepEqual(plain(collection.mainEntity.itemListElement.map((entry) => entry.position)), Array.from({ length: 12 }, (_, index) => index + 1));
    assert.equal(collection.mainEntity.itemListElement[0].url, 'https://freelance-place.com/projects/project-1');
    assert.deepEqual(plain(nodeOfType(html, 'BreadcrumbList').itemListElement.map((entry) => entry.name)), ['דף הבית', 'פרויקטים']);
    assert.ok(html.includes('הפרויקט האחרון פורסם ב־<time dateTime="2026-11-09">9 בנובמבר 2026</time>'));
  }
});

test('project index later pages: self-canonical, indexable, continued numbering and prev/next links', async () => {
  const page = projectsIndex();
  const second = await page.generateMetadata(search({ page: '2' }));
  assert.equal(second.alternates.canonical, 'https://freelance-place.com/projects?page=2');
  assert.equal(second.robots.index, true);
  assert.match(String(second.title.absolute ?? second.title), /עמוד 2/);
  let html = await renderIndex(page, { page: '2' });
  assert.ok(html.includes('<h1>פרויקטים פתוחים לפרילנסרים · עמוד 2</h1>'));
  assert.equal(count(html, /class="disc-card"/g), 12);
  assert.ok(html.includes('>פרויקט מספר 13</a>') && html.includes('>פרויקט מספר 24</a>') && !html.includes('>פרויקט מספר 12</a>'));
  assert.ok(html.includes('<a href="/projects" rel="prev"'), 'page 1 is linked as the clean URL');
  assert.ok(html.includes('<a href="/projects?page=3" rel="next"'));
  const positions = nodeOfType(html, 'CollectionPage').mainEntity.itemListElement.map((entry) => entry.position);
  assert.deepEqual(plain(positions), Array.from({ length: 12 }, (_, index) => index + 13));
  assert.equal(nodeOfType(html, 'CollectionPage').url, 'https://freelance-place.com/projects?page=2');
  assert.ok(html.includes('מוצגים 13–24 מתוך 30 פרויקטים פתוחים.'));
  assertNoShowcaseWording(html, 'project index page 2');
  html = await renderIndex(page, { page: '3' });
  assert.equal(count(html, /class="disc-card"/g), 6);
  assert.equal(html.includes('rel="next"'), false);
  assert.ok(html.includes('<a href="/projects?page=2" rel="prev"'));
  assert.equal((await page.generateMetadata(search({ page: '3' }))).alternates.canonical, 'https://freelance-place.com/projects?page=3');
});

test('project index: invalid or out-of-range pages are a 404 with noindex metadata', async () => {
  const page = projectsIndex();
  for (const value of ['0', '-1', 'abc', '1.5', '01', '4', '99', ' 2', '', ['1', '2']]) {
    await assert.rejects(page.default(search({ page: value })), NOT_FOUND, JSON.stringify(value));
    const meta = await page.generateMetadata(search({ page: value }));
    assert.equal(meta.robots.index, false, JSON.stringify(value));
    assert.equal(meta.title, 'העמוד לא נמצא');
  }
});

test('project index with nothing to list: honest empty state, noindex but followable, later pages are a 404', async () => {
  const page = projectsIndex([]);
  const empty = await renderIndex(page, {});
  assert.match(empty, /class="disc-empty"/);
  assert.equal(count(empty, /class="disc-card"/g), 0);
  assert.equal(count(empty, /class="disc-pager"/g), 0);
  assert.equal(/כרגע יש /.test(empty), false, 'no count when there are no projects');
  assertNoShowcaseWording(empty, 'empty project index');
  const meta = await page.generateMetadata(search({}));
  assert.deepEqual(plain({ index: meta.robots.index, follow: meta.robots.follow }), { index: false, follow: true });
  await assert.rejects(page.default(search({ page: '2' })), NOT_FOUND);
  const html = await renderIndex(projectsIndex([]), {});
  for (const category of categories) assert.ok(html.includes(`href="/categories/${category.slug}"`), `${category.slug} stays reachable from the empty index`);
  assert.ok(html.includes('href="/projects/new"'));
});

test('project index links the categories and the indexable skills so every hub is reachable', async () => {
  const html = await renderIndex(projectsIndex(), {});
  for (const category of categories) assert.ok(html.includes(`href="/categories/${category.slug}"`), category.slug);
  for (const skill of skillsModule.indexableSkills()) assert.ok(html.includes(`<a href="/skills/${skill.slug}" class="disc-chip">${escapeHtml(skill.name)}</a>`), skill.slug);
  assert.ok(html.includes('<a href="/skills/wordpress" class="disc-chip">WordPress</a>'), 'a project tagged WordPress links its skill page');
});

test('the proxy treats ?page as neutral on /projects only; filters and other pages keep noindex', () => {
  const { proxy } = load('src/proxy.ts', { 'next/server': { NextResponse } });
  const robots = (path) => proxy(new NextRequest(`https://freelance-place.com${path}`, { headers: { host: 'freelance-place.com' } })).headers.get('x-robots-tag');
  for (const path of ['/projects', '/projects?page=2', '/projects?page=12&utm_source=newsletter', '/projects?utm_campaign=x&page=3', '/skills/wordpress']) assert.equal(robots(path), null, path);
  for (const path of ['/projects?page=2&q=react', '/projects?category=design', '/projects?q=x', '/skills?page=2', '/?page=2', '/projects/some-project?page=2', '/categories/design?page=2']) assert.match(robots(path), /noindex/, path);
});

// ---- category pages --------------------------------------------------------------------------

const categoryData = (list, extras = {}) => ({ ...ui, ...projectsData(list), '@/lib/seo/category-faq': { categoryQuestions: extras } });
const extraQuestions = [{ question: 'שאלה נוספת ראשונה?', answer: 'תשובה ראשונה.' }, { question: 'שאלה נוספת שנייה?', answer: 'תשובה שנייה.' }];

test('category page: three or more FAQs with identical JSON-LD, skill and guide links, real counts', async () => {
  const web = categories.find((category) => category.slug === 'web-development');
  const list = [project(1), project(2), project(3, { category: 'עיצוב ומיתוג', skills: ['Shopify'] }), project(4, { category: 'עיצוב וגרפיקה' })];
  const page = load('src/app/categories/[slug]/page.tsx', categoryData(list, { 'web-development': extraQuestions }));
  const html = renderToStaticMarkup(await page.default(params('web-development')));
  assert.equal(count(html, /<h1[ >]/g), 1);
  assert.ok(html.includes(`<h1>${escapeHtml(web.title)}</h1>`), 'the existing heading is kept');
  assert.equal(count(html, /<details/g), 3);
  assert.ok(html.indexOf(`<summary>${escapeHtml(web.question)}</summary>`) < html.indexOf('<summary>שאלה נוספת ראשונה?</summary>'), 'the category question comes first');
  const faq = nodeOfType(html, 'FAQPage');
  assert.deepEqual(plain(faq.mainEntity.map((entry) => entry.name)), [web.question, ...extraQuestions.map((entry) => entry.question)]);
  assert.deepEqual(plain(faq.mainEntity.map((entry) => entry.acceptedAnswer.text)), [web.answer, ...extraQuestions.map((entry) => entry.answer)]);
  assert.ok(html.includes('כרגע יש 3 פרויקטים פתוחים בתחום הזה.'), 'two by label, one by skill; other categories are not counted');
  assertNoShowcaseWording(html, 'category page');
  assert.ok(html.includes('<a href="/skills/wordpress">'), 'the category links its indexable skill pages');
  assert.ok(html.includes('<a href="/guides/project-brief">'));
  const registered = new Set(registry.indexablePages().map((entry) => entry.path));
  assert.equal(html.includes('href="/guides/hire-a-freelancer"'), registered.has('/guides/hire-a-freelancer'), 'a guide is linked only when it is registered');
  assert.deepEqual(plain(jsonLd(html).map((node) => node['@type']).sort()), ['BreadcrumbList', 'CollectionPage', 'FAQPage']);
  assert.equal(nodeOfType(html, 'CollectionPage').mainEntity.itemListElement.length, 3);
});

test('category page falls back to its own question, says nothing for zero projects and caps the list at twelve', async () => {
  const empty = renderToStaticMarkup(await load('src/app/categories/[slug]/page.tsx', categoryData([])).default(params('design')));
  assert.equal(count(empty, /<details/g), 1, 'no extra questions: the category question alone');
  assert.equal(nodeOfType(empty, 'FAQPage').mainEntity.length, 1);
  assert.equal(/כרגע יש /.test(empty), false, 'no count sentence for zero projects');
  assert.equal(count(empty, /role="note"/g), 0);
  assert.equal(empty.includes('לכל הפרויקטים הפתוחים'), false);
  const crowded = Array.from({ length: 15 }, (_, index) => project(index + 1));
  const html = renderToStaticMarkup(await load('src/app/categories/[slug]/page.tsx', categoryData(crowded)).default(params('web-development')));
  assert.equal(count(html, /<li><a href="\/projects\/project-\d+">/g), 12);
  assert.ok(html.includes('כרגע יש 15 פרויקטים פתוחים בתחום הזה.'), 'the count covers every matching project, not only the shown ones');
  assert.match(html, /<a href="\/projects">לכל הפרויקטים הפתוחים<\/a>/);
  assert.ok(html.indexOf('>פרויקט מספר 1</a>') > 0 && html.includes('>פרויקט מספר 12</a>') && !html.includes('>פרויקט מספר 13</a>'), 'the newest twelve');
  await assert.rejects(load('src/app/categories/[slug]/page.tsx', categoryData([])).default(params('no-such-category')), NOT_FOUND);
  assert.equal((await load('src/app/categories/[slug]/page.tsx', categoryData([])).generateMetadata(params('no-such-category'))).robots.index, false);
});

// ---- project detail page ---------------------------------------------------------------------

const shell = {
  '@/components/marketplace': { AppShell: ({ children }) => createElement('div', null, children), OpportunitySignal: () => null, PageHeading: ({ title }) => createElement('h1', null, title) },
  '@/components/actions': { ProposalAction: () => null },
  '@/components/project-description': { ProjectDescription: ({ text }) => createElement('p', null, text) },
};
const renderDetail = async (list, slug) => renderToStaticMarkup(await load('src/app/projects/[slug]/page.tsx', { ...ui, ...shell, ...projectsData(list) }).default(params(slug)));

test('project page: visible breadcrumb equals its JSON-LD, publish date, skill tag links and related projects', async () => {
  const main = project(0, { slug: 'main', title: 'אתר תדמית לסטודיו', skills: ['WordPress', 'Obscure Tool'], createdAt: Date.UTC(2026, 10, 9, 22, 30) });
  const others = Array.from({ length: 8 }, (_, index) => project(index + 1, { skills: ['WordPress'] }));
  const html = await renderDetail([main, ...others, project(21, { category: 'וידאו ואנימציה', skills: ['Premiere'] })], 'main');
  assert.ok(html.includes('<a href="/">דף הבית</a>') && html.includes('<a href="/categories/web-development">פיתוח אתרים</a>'));
  assert.ok(html.includes('<span aria-current="page">אתר תדמית לסטודיו</span>'));
  const crumbs = nodesOfType(html, 'BreadcrumbList');
  assert.equal(crumbs.length, 1, 'one BreadcrumbList: the visible trail does not add a second one');
  assert.deepEqual(plain(crumbs[0].itemListElement.map((entry) => [entry.name, entry.item])), [['דף הבית', 'https://freelance-place.com/'], ['פיתוח אתרים', 'https://freelance-place.com/categories/web-development'], ['אתר תדמית לסטודיו', 'https://freelance-place.com/projects/main']]);
  assert.ok(html.includes('<time dateTime="2026-11-10">10 בנובמבר 2026</time>'), 'the Israeli calendar day of the publish time');
  assert.equal(nodeOfType(html, 'WebPage').datePublished, '2026-11-09T22:30:00.000Z');
  assert.ok(html.includes('<a href="/skills/wordpress" class="tag tag-link">WordPress</a>'));
  assert.ok(html.includes('<span class="tag">Obscure Tool</span>'));
  assert.equal(count(html, /class="disc-card"/g), 6, 'at most six related projects');
  assert.match(html, /<h2 id="related-projects-heading">פרויקטים דומים<\/h2>/);
  for (const absent of ['href="/projects/main"', 'href="/projects/project-21"', 'href="/projects/project-7"']) assert.equal(html.includes(absent), false, absent);
  assert.ok(html.includes('href="/projects/project-1"') && html.includes('href="/projects/project-6"'));
  assertNoShowcaseWording(html, 'project page');
  assert.equal(nodesOfType(html, 'WebPage').length, 1, 'a real project keeps its WebPage JSON-LD');
});

test('showcase project pages stay inside the product: noindex, no structured data, no SEO list ever includes them', async () => {
  // A showcase project still opens from the product feed (with its own label), but it is never offered to search engines.
  const demo = project(1, { slug: 'demo', sample: true, createdAt: undefined });
  const bot = project(1, { slug: 'bot', ...agent });
  const render = async (showcase, slug) => renderToStaticMarkup(await load('src/app/projects/[slug]/page.tsx', { ...ui, ...shell, ...projectsData([project(2, { skills: [] })], { [slug]: showcase }) }).default(params(slug)));
  const demoHtml = await render(demo, 'demo');
  assert.equal(jsonLd(demoHtml).length, 0, 'a showcase page carries no structured data');
  assert.ok(demoHtml.includes('class="disc-crumbs"'));
  assert.equal(demoHtml.includes('<time'), false, 'no date is invented');
  const botHtml = await render(bot, 'bot');
  assert.equal(jsonLd(botHtml).length, 0, 'an AI-agent project carries no structured data either');
  for (const [showcase, slug] of [[demo, 'demo'], [bot, 'bot']]) {
    const page = load('src/app/projects/[slug]/page.tsx', { ...ui, ...shell, ...projectsData([], { [slug]: showcase }) });
    const meta = await page.generateMetadata(params(slug));
    assert.equal(meta.robots.index, false, `${slug} is noindex`);
    assert.equal(meta.alternates?.canonical, `https://freelance-place.com/projects/${slug}`, `${slug} keeps a self canonical`);
  }
  const real = await load('src/app/projects/[slug]/page.tsx', { ...ui, ...shell, ...projectsData([project(1, { slug: 'solo' })]) }).generateMetadata(params('solo'));
  assert.equal(real.robots.index, true, 'a real client project stays indexable');
});

test('project page shows no related section or date without data, and a missing project is a 404', async () => {
  const alone = await renderDetail([project(1, { slug: 'solo', createdAt: undefined })], 'solo');
  assert.equal(alone.includes('disc-related'), false);
  assert.equal(alone.includes('<time'), false, 'no date is invented');
  assert.equal(nodesOfType(alone, 'WebPage').length, 1);
  await assert.rejects(load('src/app/projects/[slug]/page.tsx', { ...ui, ...shell, ...projectsData([]) }).default(params('missing')), NOT_FOUND);
});

// ---- 404 -------------------------------------------------------------------------------------

test('404 page: Hebrew, inside the layout, noindex, with links from the registry only', () => {
  const page = load('src/app/not-found.tsx', ui);
  const html = renderToStaticMarkup(page.default());
  assert.ok(html.includes('<h1>העמוד לא נמצא</h1>'));
  assert.equal(count(html, /<h1[ >]/g), 1);
  assert.equal(page.metadata.title, 'העמוד לא נמצא');
  assert.equal(page.metadata.robots.index, false);
  assert.ok(html.indexOf('href="/projects"') > 0 && html.indexOf('href="/projects"') < html.indexOf('href="/skills"'), 'the projects hub comes first');
  for (const category of categories) assert.ok(html.includes(`href="/categories/${category.slug}"`), category.slug);
  assert.ok(html.includes('href="/projects/new"') && html.includes('href="/"'));
  assert.match(html, /class="discovery-header"/, 'the public header is reused');
  // A hub that is not indexable is not linked.
  const env = catalogue([synthetic('only-thin', { deliverables: [] })]);
  const without = renderToStaticMarkup(load('src/app/not-found.tsx', { ...ui, ...env.stubs }).default());
  assert.equal(without.includes('href="/skills"'), false);
  assert.ok(without.includes('href="/projects"'));
  assert.ok(existsSync(`${projectRoot}/src/app/not-found.tsx`));
});

// ---- policy ----------------------------------------------------------------------------------

test('new landing-page code builds URLs from the site helpers and never hard-codes the origin or localhost', () => {
  const files = [
    'src/app/skills/page.tsx', 'src/app/skills/[slug]/page.tsx', 'src/app/projects/page.tsx', 'src/app/projects/[slug]/page.tsx', 'src/app/categories/[slug]/page.tsx', 'src/app/not-found.tsx', 'src/proxy.ts',
    'src/components/discovery/breadcrumbs.tsx', 'src/components/discovery/project-cards.tsx', 'src/components/discovery/skill-article.tsx', 'src/components/discovery/pagination.tsx', 'src/components/discovery/public-content.tsx',
    'src/lib/seo/skills.ts', 'src/lib/seo/skill-match.ts', 'src/lib/seo/hubs.ts', 'src/lib/seo/listing.ts', 'src/lib/seo/linking.ts', 'src/lib/seo/pagination.ts', 'src/lib/seo/dates.ts', 'src/lib/seo/related.ts', 'src/lib/seo/category-page.ts',
  ];
  for (const file of files) {
    const source = readFileSync(`${projectRoot}/${file}`, 'utf8');
    assert.doesNotMatch(source, /freelance-place\.com|localhost|127\.0\.0\.1/, file);
    assert.doesNotMatch(source, /JobPosting|AggregateRating|"Review"|'Review'/, `${file} adds no job, review or rating markup`);
  }
});
