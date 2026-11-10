import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { loadModule, projectRoot } from './helpers/load-ts.mjs';

// Showcase projects (seeded, published by an AI agent) are labelled inside the product, but they are
// not client demand. Nothing that search engines or answer engines read may mention them, list them,
// count them or link to them. These tests guard that at the source (no wording, no helper that
// brings it back) and in the generated text (FAQs, info pages, registry copy and both llms files).

const ORIGIN = 'https://freelance-place.com';
const env = { SITE_INDEXABLE: 'true', NEXT_PUBLIC_SITE_URL: ORIGIN };
const billingOn = { ...env, BILLING_ENABLED: 'true', CARDCOM_TERMINAL_NUMBER: '1', CARDCOM_API_NAME: 'x' };
const load = (entry, variant = env) => loadModule(entry, { env: variant });

// Wording that presents a project as AI-made, a sample or a demo, in Hebrew and English.
const SHOWCASE_WORDING = /סוכן AI|סוכני AI|סוכן ה־?AI|פרויקט הדגמה|פרויקטי הדגמה|פרויקט השראה|פרויקטי השראה|פרויקטים לדוגמה|פרויקט לדוגמה|AI[ -]agent|sample project|demo project|showcase project|synthetic project/i;
// Code that exists only to label, count or list showcase projects on a public page.
const SHOWCASE_CODE = /AI_AGENT_BADGE|SAMPLE_[A-Z_]+|AiAgentNote|ai-agent-badge|isAiAgentProject|countAiAgentProjects|aiAgentAnswer|publicProjects|isPublicProject|sample-project/;

function sourceFiles(path) {
  const absolute = `${projectRoot}/${path}`;
  if (!statSync(absolute).isDirectory()) return [path];
  return readdirSync(absolute).flatMap((name) => sourceFiles(`${path}/${name}`));
}
// Everything an SEO surface is built from: the SEO library, the discovery components and the public pages.
const SEO_ROOTS = [
  'src/lib/seo', 'src/components/discovery',
  'src/app/alternatives', 'src/app/categories', 'src/app/skills', 'src/app/guides', 'src/app/glossary', 'src/app/faq', 'src/app/about', 'src/app/how-it-works', 'src/app/pricing',
  'src/app/llms.txt', 'src/app/llms-full.txt', 'src/app/projects/page.tsx',
  'src/app/page.tsx', 'src/app/layout.tsx', 'src/app/not-found.tsx', 'src/app/sitemap.ts', 'src/app/robots.ts',
];
const seoFiles = SEO_ROOTS.flatMap(sourceFiles).filter((file) => /\.(ts|tsx|css)$/.test(file));

test('the SEO surfaces are found, so the source scans below cannot pass on an empty list', () => {
  assert.ok(seoFiles.length > 60, `only ${seoFiles.length} files`);
  for (const file of ['src/lib/seo/comparison.ts', 'src/lib/seo/publication.ts', 'src/components/discovery/project-cards.tsx', 'src/app/alternatives/xplace/page.tsx', 'src/app/llms-full.txt/route.ts']) assert.ok(seoFiles.includes(file), file);
});

test('no SEO source labels, counts or lists showcase projects, and none brings a helper for it back', () => {
  for (const file of seoFiles) {
    const source = readFileSync(`${projectRoot}/${file}`, 'utf8');
    assert.doesNotMatch(source, SHOWCASE_CODE, `${file} uses showcase-project code`);
    // The publication rule itself names the AI-agent marker it excludes, in prose and in one comparison; nothing else may.
    if (file !== 'src/lib/seo/publication.ts') assert.doesNotMatch(source, SHOWCASE_WORDING, `${file} mentions showcase projects`);
  }
});

test('the one place that knows the showcase markers is the publication rule, and every discovery read goes through it', () => {
  const publication = readFileSync(`${projectRoot}/src/lib/seo/publication.ts`, 'utf8');
  assert.match(publication, /export function isSyntheticProject/);
  assert.match(publication, /export function isDiscoverableProject/);
  for (const reader of ['src/lib/seo/projects.ts', 'src/lib/db/projects.ts', 'src/lib/projects/events.ts']) {
    assert.match(readFileSync(`${projectRoot}/${reader}`, 'utf8'), /isDiscoverableProject/, `${reader} applies the discoverability rule`);
  }
  // Only the data layer and the publication rule look at ownership markers; pages and components never do.
  for (const file of seoFiles.filter((candidate) => candidate !== 'src/lib/seo/publication.ts')) {
    assert.doesNotMatch(readFileSync(`${projectRoot}/${file}`, 'utf8'), /ownerKind|owner\??\.kind|\.sample\b|\bunreal\b/, `${file} reads showcase markers itself`);
  }
});

test('the generated FAQs, info pages and registry copy never mention showcase projects, in either billing state', () => {
  for (const variant of [billingOn, env]) {
    const facts = load('src/lib/seo/facts.ts', variant).membershipFacts(variant);
    const content = load('src/lib/seo/content.ts', variant);
    const info = load('src/lib/seo/info-content.ts', variant);
    const registry = load('src/lib/seo/registry.ts', variant);
    const generated = {
      homeQuestions: content.getHomeQuestions(facts),
      comparisonQuestions: content.getComparisonQuestions(facts),
      pricing: info.pricingContent(facts), about: info.aboutContent(), howItWorks: info.howItWorksContent(), faq: info.faqContent(facts),
      pages: registry.allPages().map((page) => ({ path: page.path, title: page.title, description: page.description, note: page.llms?.note })),
      membershipAnswer: load('src/lib/seo/facts.ts', variant).membershipAnswer(facts),
      glossary: load('src/lib/seo/glossary-data.ts', variant).glossaryTerms,
      categories: load('src/lib/seo/categories.ts', variant).categories,
      categoryQuestions: load('src/lib/seo/category-faq.ts', variant).categoryQuestions,
    };
    for (const [name, value] of Object.entries(generated)) {
      assert.doesNotMatch(JSON.stringify(value), SHOWCASE_WORDING, `${name} mentions showcase projects`);
    }
    assert.ok(generated.pages.length > 40, 'the registry copy was actually scanned');
    // The question that exposed the problem is gone from the home FAQ and from the FAQ page.
    const questions = [...generated.homeQuestions, ...generated.faq.groups.flatMap((group) => group.items), ...generated.comparisonQuestions];
    assert.equal(questions.some((item) => /כל פרויקט|כל הפרויקטים|פרויקט אמיתי|פרויקטים אמיתיים/.test(item.question)), false);
  }
});

test('llms.txt and llms-full.txt never mention showcase projects, in either billing state', async () => {
  for (const variant of [billingOn, env]) {
    for (const route of ['src/app/llms.txt/route.ts', 'src/app/llms-full.txt/route.ts']) {
      const text = await load(route, variant).GET().text();
      assert.ok(text.length > 1500, `${route} was generated`);
      assert.doesNotMatch(text, SHOWCASE_WORDING, `${route} mentions showcase projects`);
      assert.doesNotMatch(text, /AI agent/i, route);
    }
  }
});

test('the sitemap lists no showcase project and not the project index while it has nothing to list', async () => {
  const sitemap = (projects) => loadModule('src/app/sitemap.ts', { env, stubs: { '@/lib/seo/projects': { sitemapProjects: async () => projects } } });
  const empty = await sitemap([]).default();
  const urls = empty.map((entry) => entry.url);
  assert.equal(urls.includes(`${ORIGIN}/projects`), false);
  assert.equal(urls.some((url) => url.includes('/projects/')), false);
  assert.equal(urls.some((url) => url.includes('seed-')), false);
  const real = await sitemap([{ slug: 'real-project' }]).default();
  assert.ok(real.some((entry) => entry.url === `${ORIGIN}/projects`) && real.some((entry) => entry.url === `${ORIGIN}/projects/real-project`));
});
