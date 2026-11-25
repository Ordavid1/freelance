import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadModule, projectRoot } from './helpers/load-ts.mjs';

// LIVE marks open projects of real clients, the AI-agent badge marks closed showcase projects, the headhunter tag keeps
// its link, new showcase projects can no longer be seeded, and the privacy page covers agency contact details.

const read = (path) => readFileSync(`${projectRoot}/${path}`, 'utf8');
const env = { SITE_INDEXABLE: 'true', NEXT_PUBLIC_SITE_URL: 'https://freelance-place.com' };
const ui = {
  'next/link': { __esModule: true, default: ({ href, children, prefetch, ...rest }) => createElement('a', { href, ...rest }, children) },
  'next/image': { __esModule: true, default: ({ src, alt }) => createElement('img', { src, alt }) },
  'next/dynamic': { __esModule: true, default: () => () => null },
};
const hh = { name: 'אופק גיוס', handle: 'ofek-hr' };
const base = { category: 'פיתוח אתרים', description: 'תיאור מלא של הפרויקט.', budget: '₪1,000', deadline: 'גמיש', posted: 'לפני שעה', client: 'לקוח/ה', clientHistory: '', skills: ['React'], proposals: 0, fit: '', activity: '', createdAt: 5 };
const open = { ...base, slug: 'open-real', title: 'פרויקט פתוח אמיתי', status: 'open' };
const openLegacy = { ...base, slug: 'open-legacy', title: 'פרויקט ללא סטטוס' };
const openTagged = { ...base, slug: 'open-tagged', title: 'פרויקט פתוח מתויג', status: 'open', headhunter: hh };
const closedReal = { ...base, slug: 'closed-real', title: 'פרויקט סגור אמיתי', status: 'closed' };
const archived = { ...base, slug: 'archived-real', title: 'פרויקט בארכיון', status: 'archived' };
const closedAi = { ...base, slug: 'closed-ai', title: 'פרויקט סגור של סוכן', status: 'closed', sample: true, ownerKind: 'ai-agent' };
const openAi = { ...base, slug: 'open-ai', title: 'פרויקט פתוח של סוכן', status: 'open', sample: true, ownerKind: 'ai-agent' };

const LIVE = /class="live-badge"/;
const AI = /class="ai-agent-badge"/;
const live = (html) => (html.match(/class="live-badge"/g) ?? []).length;

function feed(initialProjects) {
  const source = loadModule('src/components/workspace-home.tsx', { env, stubs: {
    ...ui,
    './view-mode': { useViewMode: () => ({ mode: 'freelancer', setMode: () => {} }) },
    './my-applications': { MyApplications: () => null }, '@/components/trial-status': { TrialStatus: () => null }, '@/components/auth-control': { AuthControl: () => null },
    './account-safety': { AccountSafetyNotice: () => null },
    '@/components/viewer-context': { ViewerProvider: ({ children }) => children, useViewer: () => ({ status: 'signed-out', user: null }) },
    '@/components/project-description': { ProjectDescription: ({ text }) => createElement('p', null, text) },
  } });
  const html = renderToStaticMarkup(createElement(source.default, { initialProjects }));
  const cards = new Map();
  for (const card of html.split('<article ').slice(1)) {
    const title = [...[open, openLegacy, openTagged, closedReal, archived, closedAi, openAi]].find((project) => card.includes(project.title));
    if (title) cards.set(title.slug, card.slice(0, card.indexOf('</article>')));
  }
  return cards;
}

test('LIVE badge: accessible Hebrew name, Latin ltr text, decorative dot', () => {
  const { LiveBadge } = loadModule('src/components/live-badge.tsx', { env });
  const html = renderToStaticMarkup(createElement(LiveBadge));
  assert.match(html, /^<span class="live-badge" dir="ltr" role="img" aria-label="פרויקט פתוח">/);
  assert.match(html, /<i class="live-badge-dot" aria-hidden="true"><\/i>/);
  assert.match(html, />LIVE<\/span>/);
  const css = read('src/components/live-badge.css');
  assert.match(css, /@keyframes live-badge-pulse/);
  assert.match(css, /prefers-reduced-motion:reduce\)\{[^}]*animation:none/);
});

test('badge rules: LIVE only for open real projects, AI only for closed showcase projects', () => {
  const { showsAiBadge, showsLiveBadge } = loadModule('src/lib/projects/presentation.ts', { env });
  assert.deepEqual([open, openLegacy, openTagged, closedReal, archived, closedAi, openAi].map((p) => showsLiveBadge(p)), [true, true, true, false, false, false, false]);
  assert.deepEqual([open, openLegacy, openTagged, closedReal, archived, closedAi, openAi].map((p) => showsAiBadge(p)), [false, false, false, false, false, true, false]);
  assert.equal(showsAiBadge({ status: 'closed', unreal: true, owner: { kind: 'ai-agent' } }), false, 'the badge reads the public model, whose marker is sample/ownerKind');
});

test('feed card: LIVE on open projects (tagged row and untagged row), AI only on closed showcase cards', () => {
  const cards = feed([openTagged, open, openLegacy, closedReal, archived, closedAi, openAi]);
  for (const slug of ['open-real', 'open-legacy']) assert.equal(live(cards.get(slug)), 1, slug);
  const tagged = cards.get('open-tagged');
  assert.equal(live(tagged), 1);
  assert.ok(tagged.indexOf('class="live-badge"') < tagged.indexOf('class="hh-tag"') && tagged.indexOf('class="hh-tag"') < tagged.indexOf('class="expand-project"'), 'LIVE and the tag share the sibling row above the button');
  assert.match(cards.get('open-real'), /<button class="expand-project"[^>]*><div class="project-category">.*class="live-badge"/, 'untagged: LIVE in the row inside the button');
  for (const slug of ['closed-real', 'archived-real', 'closed-ai', 'open-ai']) if (cards.has(slug)) assert.doesNotMatch(cards.get(slug), LIVE, slug);
  assert.match(cards.get('closed-ai'), AI);
  assert.match(cards.get('closed-ai'), /נסגר/);
  for (const slug of ['open-real', 'open-legacy', 'open-tagged', 'closed-real', 'open-ai']) if (cards.has(slug)) assert.doesNotMatch(cards.get(slug), AI, slug);
  const onlyOpenAi = feed([openAi]).get('open-ai');
  assert.ok(!onlyOpenAi || (!AI.test(onlyOpenAi) && !LIVE.test(onlyOpenAi)), 'an open showcase record shows neither badge');
});

test('static showcase cards stay closed AI cards with no LIVE tag', () => {
  const { projects } = loadModule('src/lib/data.ts', { env });
  const html = renderToStaticMarkup(createElement(loadModule('src/components/marketplace.tsx', { env, stubs: ui }).ProjectCard, { project: projects[0] }));
  assert.equal(projects.every((p) => p.status === 'closed' && p.sample), true);
  assert.match(html, AI);
  assert.doesNotMatch(html, LIVE);
});

test('marketplace ProjectCard: LIVE in the tag row of open real projects only', () => {
  const { ProjectCard } = loadModule('src/components/marketplace.tsx', { env, stubs: ui });
  const render = (project) => renderToStaticMarkup(createElement(ProjectCard, { project }));
  const opened = render(open);
  assert.equal(live(opened), 1);
  assert.match(opened, /<span class="card-topline-tags"><span class="category-chip">[^<]*<\/span><span class="live-badge"/);
  const withTag = render(openTagged);
  assert.ok(withTag.indexOf('class="live-badge"') < withTag.indexOf('class="hh-tag"'));
  for (const project of [closedReal, archived, closedAi, openAi]) assert.doesNotMatch(render(project), LIVE, project.slug);
  assert.match(render(closedAi), AI);
  for (const project of [open, openTagged, closedReal, archived, openAi]) assert.doesNotMatch(render(project), AI, project.slug);
});

test('discovery ProjectCardList: LIVE on open projects with and without a headhunter tag, not on closed ones (lists only receive real projects)', () => {
  const { ProjectCardList } = loadModule('src/components/discovery/project-cards.tsx', { env, stubs: ui });
  const render = (projects) => renderToStaticMarkup(createElement(ProjectCardList, { projects, skills: [] }));
  const html = render([open, openTagged, closedReal, archived]);
  assert.equal(live(html), 2);
  assert.match(html, /<p class="disc-card-tags"><span class="live-badge"[^>]*>.*?<\/span><span class="employment-badge employment-freelance">פרילנס<\/span><a href="\/ofek-hr" class="hh-tag"/);
  // Every card carries the employment label, so every card has a tags row.
  assert.equal((html.match(/class="disc-card-tags"/g) ?? []).length, 4);
});

function detail(current) {
  const page = loadModule('src/app/projects/[slug]/page.tsx', { env, stubs: {
    ...ui,
    'next/navigation': { notFound() { throw new Error('NEXT_NOT_FOUND'); } },
    '@/components/marketplace': { AppShell: ({ children }) => createElement('div', null, children), OpportunitySignal: () => null, PageHeading: ({ eyebrow, title }) => createElement('div', null, createElement('p', { className: 'eyebrow' }, eyebrow), createElement('h1', null, title)) },
    '@/components/actions': { ProposalAction: () => null },
    '@/components/project-description': { ProjectDescription: ({ text }) => createElement('p', null, text) },
    '@/lib/seo/projects': { readPublicProject: async () => current, discoveryProjects: async () => [] },
    '@/lib/db/headhunters': { getHeadhunterByHandle: async () => ({ kind: 'none' }) },
    '@/lib/db/projects': { getHeadhunterProjects: async () => ({ openCount: 0, publishedCount: 0, items: [], closed: [] }) },
  } });
  return page.default({ params: Promise.resolve({ slug: current.slug }) }).then((tree) => renderToStaticMarkup(tree));
}

test('project page: LIVE in the eyebrow of open real projects; AI badge only for closed showcase projects', async () => {
  const opened = await detail(open);
  assert.equal(live(opened), 1);
  assert.match(opened, /<p class="eyebrow">[^<]*<span class="live-badge"/);
  const tagged = await detail(openTagged);
  assert.ok(tagged.indexOf('class="live-badge"') < tagged.indexOf('class="hh-tag"'));
  for (const project of [closedReal, archived, closedAi, openAi]) assert.doesNotMatch(await detail(project), LIVE, project.slug);
  assert.match(await detail(closedAi), AI);
  for (const project of [open, closedReal, openAi]) assert.doesNotMatch(await detail(project), AI, project.slug);
});

test('headhunter tag: still one link with the same label, and the same pill family as the other two badges', () => {
  const { HeadhunterTag, HeadhunterTagPill } = loadModule('src/components/headhunter-tag.tsx', { env, stubs: ui });
  const html = renderToStaticMarkup(createElement(HeadhunterTag, { headhunter: hh }));
  assert.match(html, /^<a href="\/ofek-hr" class="hh-tag" aria-label="פרויקט של אופק גיוס, לעמוד הסוכנות">/);
  assert.equal((html.match(/<a /g) ?? []).length, 1);
  assert.match(renderToStaticMarkup(createElement(HeadhunterTagPill, { headhunter: hh })), /^<span class="hh-tag" aria-hidden="true">/);
  const tag = read('src/components/headhunter-tag.css').match(/\.hh-tag\{[^}]*\}/)[0];
  const aiRule = read('src/app/globals.css').match(/\.ai-agent-badge\{[^}]*\}/)[0];
  const liveRule = read('src/components/live-badge.css').match(/\.live-badge\{[^}]*\}/)[0];
  for (const rule of [tag, aiRule, liveRule]) for (const part of ['border-radius:999px', 'font-size:11px', 'padding:1px 7px']) {
    assert.ok(rule.includes(part) || (part === 'font-size:11px' && /font:700 11px/.test(rule)), `${part} in ${rule.slice(0, 40)}`);
  }
  assert.match(tag, /border:1px solid/);
  assert.match(read('src/components/headhunter-tag.css'), /@media\(max-width:560px\)\{\.hh-tag-url \.hh-host\{display:none\}\}/);
});

test('owner view: the close button follows the expand button in the card summary, in flow, for open projects only', () => {
  const source = read('src/components/workspace-home.tsx');
  const expand = source.indexOf('<button className="expand-project"');
  const close = source.indexOf('<CloseProjectButton');
  const save = source.indexOf('<button className="studio-save"');
  assert.ok(expand > 0 && expand < source.indexOf('</button>', expand) && source.indexOf('</button>', expand) < close && close < save);
  assert.match(source, /viewingOwn && projectStatusValue === 'open' && <CloseProjectButton/);
  const css = read('src/app/studio.css');
  assert.doesNotMatch(css.match(/\.project-close-action\{[^}]*\}/)[0], /position:absolute/);
  assert.doesNotMatch(read('src/components/project-proposals.tsx'), /archive|DELETE/i);
});

test('seed tool refuses to create showcase projects on commit and says so in a dry run', () => {
  const { planSeed, creationsIn, CREATES_DISABLED_MESSAGE, seedDocId, buildCreateFields } = loadModule('scripts/seed-projects/catalog.ts', { env });
  const entry = (slug) => ({ slug, title: `פרויקט ${slug}`, category: 'פיתוח אתרים', description: 'תיאור מספיק ארוך לפרויקט', budget: '₪1', deadline: 'גמיש', clientName: 'לקוח', persona: 'פרסונה קצרה', skills: ['React'] });
  const entries = [entry('aaa-one'), entry('bbb-two')];
  const stored = { ...buildCreateFields(entries[0], 'b1'), createdAt: 1 };
  assert.equal(creationsIn(planSeed(entries, 'b1', new Map())).length, 2);
  assert.equal(creationsIn(planSeed([entries[0]], 'b1', new Map([[seedDocId('aaa-one'), stored]]))).length, 0, 'updates and unchanged records are not creations');
  assert.match(CREATES_DISABLED_MESSAGE, /Creating new showcase projects is disabled/);
  const cli = read('scripts/seed-projects/seed-projects.ts');
  assert.ok(!cli.includes('buildCreateFields') && !/\.create\(/.test(cli), 'the CLI has no create path');
  const refuse = cli.indexOf('creationsIn(plan)');
  assert.ok(refuse > 0 && refuse < cli.indexOf('db.batch()', cli.indexOf('const bySlug')), 'the refusal comes before any seed write');
  assert.match(cli, /if \(commit && creations\.length\)[\s\S]*process\.exit\(1\)/);
  assert.match(cli, /CREATES_DISABLED_MESSAGE/);
});

test('privacy page: agency contact paragraph in the public-information section, legal date is 23 November 2026', () => {
  const privacy = read('src/app/privacy/page.tsx');
  const paragraph = 'סוכנויות ומגייסים שמפעילים עמוד סוכנות ב־Freelance Place בוחרים אילו פרטי קשר עסקיים לפרסם בו (כמו אימייל, טלפון, וואטסאפ, אתר ועמוד LinkedIn). פרטים אלה מוצגים בפומבי בעמוד הסוכנות, וניתן לשנות או למחוק אותם בכל עת מעמוד העריכה.';
  assert.equal(privacy.split(paragraph).length - 1, 1);
  const section = privacy.slice(privacy.indexOf("id: 'visibility'"));
  assert.ok(section.indexOf(paragraph) > 0 && section.indexOf(paragraph) < section.indexOf("id: '", 10), 'inside the visibility section');
  const identity = loadModule('src/lib/legal/identity.ts');
  assert.equal(identity.legalUpdated, '2026-11-23');
  assert.equal(identity.legalUpdatedLabel, '23 בנובמבר 2026');
});
