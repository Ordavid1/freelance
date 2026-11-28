import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { loadModule, projectRoot } from './helpers/load-ts.mjs';
import { loadPolicy } from './helpers/policy.mjs';
import { switchStub } from './helpers/runtime-switch.mjs';
import { ORIGIN, baseEnv, jsonLd, load, ofType, plain, render, text, uiStubs } from './helpers/seo-pages-harness.mjs';

// The /ai page, its place in every list, and the MCP endpoint's standing as an API. Everything here follows the 'mcp' runtime switch.
const PATH = '/ai';
const MCP = new Set(['mcp']);
const env = baseEnv;
const registry = loadModule('src/lib/seo/registry.ts', { env });
const content = loadModule('src/lib/seo/info-content.ts', { env }).aiContent();
const entry = registry.pageByPath(PATH);
const stubs = (on = []) => ({ ...uiStubs, ...switchStub(on) });

// ---- registry ----
test('registry: /ai is an information page behind the mcp switch, within the registry rules, with its route', () => {
  assert.ok(entry, 'registered');
  assert.equal(entry.kind, 'info');
  assert.equal(entry.requiresFeature, 'mcp');
  assert.equal(entry.published, '2026-11-28');
  assert.equal(entry.modified, '2026-11-28');
  assert.ok(entry.title.length >= 20 && entry.title.length <= 60, `title ${entry.title.length}`);
  assert.ok(entry.description.length >= 70 && entry.description.length <= 165, `description ${entry.description.length}`);
  assert.match(entry.llms.note, /^[\x20-\x7e]+$/, 'the llms note is English');
  assert.ok(registry.allPages().includes(entry), 'allPages() keeps every page for validation');
  assert.ok(existsSync(`${projectRoot}/src/app/ai/page.tsx`), 'the route exists');
});

test('registry: every information, hub and legal page has its route file', () => {
  for (const page of registry.allPages().filter((item) => ['info', 'hub', 'legal'].includes(item.kind))) {
    assert.ok(existsSync(`${projectRoot}/src/app${page.path}/page.tsx`), `${page.path} has a route`);
  }
});

test('indexablePages: a page behind a switch is listed only when its feature is served', () => {
  const paths = (served) => registry.indexablePages(served).map((page) => page.path);
  assert.equal(paths().includes(PATH), false, 'safe by default');
  assert.equal(paths(new Set()).includes(PATH), false);
  assert.equal(paths(new Set(['ai'])).includes(PATH), false, 'another feature does not serve it');
  assert.equal(paths(MCP).includes(PATH), true);
  assert.deepEqual(plain(paths(MCP).filter((path) => path !== PATH)), plain(paths()), 'serving the feature adds that page and nothing else');
  assert.deepEqual(plain(registry.requiredFeatures()), ['mcp'], 'the features come from the registry');
});

test('servedFeatures: reads each required feature from the runtime switch and nothing else', async () => {
  const asked = [];
  const served = (on) => loadModule('src/lib/seo/served.ts', { env, stubs: { '@/lib/security/runtime-switch': { featureEnabled: async (feature) => { asked.push(feature); return on.includes(feature); } } } }).servedFeatures();
  assert.deepEqual([...(await served(['mcp']))], ['mcp']);
  assert.deepEqual([...(await served([]))], []);
  assert.deepEqual([...(await served(['ai']))], [], 'a switch no page requires is not asked about');
  assert.deepEqual([...new Set(asked)], ['mcp']);
});

// ---- the page ----
test('/ai: 404 while the switch is off; otherwise the answer-first article with its structured data', async () => {
  const route = (on) => load('src/app/ai/page.tsx', { env, stubs: switchStub(on) });
  assert.equal(route([]).dynamic, 'force-dynamic');
  await assert.rejects(async () => route([]).default(), /NEXT_NOT_FOUND/);
  const html = render(await route(['mcp']).default());
  assert.match(html, new RegExp(`<h1[^>]*>${content.h1}</h1>`));
  assert.ok(html.includes(`${ORIGIN}/mcp`), 'the endpoint is shown so it can be copied');
  for (const href of ['/projects/new', '/projects']) assert.ok(html.includes(`href="${href}"`), href);
  const nodes = jsonLd(html);
  assert.equal(ofType(html, 'WebPage').length, 1);
  assert.equal(ofType(html, 'BreadcrumbList').length, 1);
  assert.equal(ofType(html, 'WebPage')[0].url ?? `${ORIGIN}${PATH}`, `${ORIGIN}${PATH}`);
  assert.ok(nodes.length >= 2);
  assert.equal(ofType(html, 'FAQPage').length, 1);
  const metadata = load('src/app/ai/page.tsx', { env, stubs: switchStub(['mcp']) }).metadata;
  assert.equal(metadata.alternates.canonical, `${ORIGIN}${PATH}`);
  assert.equal(metadata.description, entry.description);
});

test('/ai copy: states what ships, names no product and promises nothing', () => {
  const all = JSON.stringify(content);
  assert.ok(content.sections.length >= 3 && content.faq.length >= 3 && content.faq.length <= 5);
  assert.ok(content.summary.length <= 320, 'the summary fits its limit');
  assert.ok(content.related.length >= 3 && content.related.length <= 6);
  for (const path of content.related) assert.ok(registry.pageByPath(path), `${path} is registered`);
  assert.ok(all.includes(`${ORIGIN}/mcp`), 'the endpoint comes from absoluteUrl');
  assert.doesNotMatch(readFileSync(`${projectRoot}/src/lib/seo/info-content.ts`, 'utf8'), /freelance-place\.com|localhost/, 'no hard-coded origin');
  for (const tool of ['search_projects', 'get_project', 'list_categories', 'list_skills', 'list_guides', 'get_guide', 'get_platform_facts', 'list_agencies']) assert.ok(all.includes(tool), tool);
  assert.match(all, /streamable HTTP/);
  assert.match(all, /קריאה בלבד/);
  assert.match(all, /custom connector/);
  assert.match(all, /rate|מוגבלות בקצב/);
  assert.doesNotMatch(all, /ChatGPT|OpenAI|Claude|Anthropic|Cursor|Gemini|Copilot|Perplexity|VS ?Code|Windsurf/i, 'no specific client is named');
  assert.doesNotMatch(all, /ספרי|מדריך המחברים|מאושר|תומך ב־(?!חיבור)/, 'no directory listing or compatibility claim');
  assert.doesNotMatch(all, /\d{4}|רבעון|בקרוב|בחודש/, 'no dates or timeframes are promised');
  assert.doesNotMatch(all, /לוג|תיעוד בקשות|נשמר|שמירת|retention|log/i, 'nothing is said about logging or retention');
});

// ---- every surface, on and off ----
const strip = (full, h1) => {
  const start = full.indexOf(`### ${h1}`);
  assert.notEqual(start, -1, 'the information block is present');
  const next = full.slice(start + 1).search(/\n#{2,3} /);
  const rest = next === -1 ? '' : full.slice(start + 1 + next + 1);
  return `${(full.slice(0, start) + rest).trimEnd()}\n`;
};
const withoutLines = (value, needle) => value.split('\n').filter((line) => !line.includes(needle)).join('\n');

test('llms.txt: the page and the MCP line appear only while mcp is served, and the rest is byte-identical', () => {
  const llms = loadModule('src/lib/seo/llms.ts', { env });
  const off = llms.llmsTxt();
  assert.equal(llms.llmsTxt(undefined, new Set()), off);
  assert.equal(off.includes(`${ORIGIN}${PATH}`) || off.includes('/mcp') || /MCP/.test(off), false);
  const on = llms.llmsTxt(undefined, MCP);
  assert.match(on, new RegExp(`\\n- \\[${entry.title}\\]\\(${ORIGIN}${PATH}\\): `), 'the page is listed under Product with its note');
  assert.match(on, new RegExp(`\\n- \\[MCP server\\]\\(${ORIGIN}/mcp\\): [^\\n]*streamable HTTP[^\\n]*read-only[^\\n]*without sign-in`));
  assert.ok(on.indexOf('[MCP server]') > on.indexOf('## Optional'), 'under Optional');
  assert.equal(withoutLines(withoutLines(on, `(${ORIGIN}${PATH})`), `(${ORIGIN}/mcp)`), off, 'only those two lines are added');
});

test('llms-full.txt: the page content is in the information pages only while mcp is served, and the rest is byte-identical', () => {
  const llms = loadModule('src/lib/seo/llms.ts', { env });
  const off = llms.llmsFullTxt();
  assert.equal(llms.llmsFullTxt(undefined, [], new Set()), off);
  assert.equal(off.includes(`${ORIGIN}${PATH}`) || off.includes(content.h1), false);
  const on = llms.llmsFullTxt(undefined, [], MCP);
  const block = on.slice(on.indexOf(`### ${content.h1}`));
  assert.ok(block.includes(`Source: ${ORIGIN}${PATH}\nLast updated: ${entry.modified}`));
  assert.ok(block.includes(content.summary));
  for (const section of content.sections) assert.ok(block.includes(section.answer), section.id);
  for (const { answer } of content.faq) assert.ok(block.includes(answer));
  assert.equal(strip(withoutLines(on, `(${ORIGIN}${PATH})`), content.h1), off);
});

test('the llms routes pass the served features through', async () => {
  const route = (entryFile, on) => loadModule(entryFile, { env, stubs: { ...switchStub(on), '@/lib/seo/headhunters': { indexableHeadhunterPages: async () => [] }, '@/lib/security/policy': loadPolicy({ '@/lib/auth/session': { getCurrentUser: async () => null, isSameOrigin: () => true } }) } });
  for (const file of ['src/app/llms.txt/route.ts', 'src/app/llms-full.txt/route.ts']) {
    const off = await (await route(file, []).GET()).text();
    const on = await (await route(file, ['mcp']).GET()).text();
    assert.equal(off.includes(`${ORIGIN}${PATH}`), false, `${file} off`);
    assert.equal(on.includes(`${ORIGIN}${PATH}`), true, `${file} on`);
  }
});

test('sitemap: /ai is listed with its date only while mcp is served, and the rest is unchanged', async () => {
  const sitemap = (on, indexable = 'true') => loadModule('src/app/sitemap.ts', { env: { ...env, SITE_INDEXABLE: indexable }, stubs: { ...switchStub(on), '@/lib/seo/projects': { sitemapProjects: async () => [] }, '@/lib/seo/headhunters': { indexableHeadhunterPages: async () => [], headhunterLandingServed: async () => true } } }).default();
  const off = await sitemap([]);
  const on = await sitemap(['mcp']);
  assert.equal(off.some((item) => item.url === `${ORIGIN}${PATH}`), false);
  assert.deepEqual(plain(on.find((item) => item.url === `${ORIGIN}${PATH}`)), { url: `${ORIGIN}${PATH}`, lastModified: entry.modified });
  assert.deepEqual(plain(on.filter((item) => item.url !== `${ORIGIN}${PATH}`)), plain(off));
  assert.equal(off.some((item) => item.url.endsWith('/mcp')) || on.some((item) => item.url.endsWith('/mcp')), false, 'the endpoint is never a sitemap URL');
  assert.deepEqual(plain(await sitemap(['mcp'], 'false')), [], 'nothing is listed while indexing is off');
});

test('footer: the link to /ai appears only while mcp is served; footerGroups() without arguments is the old footer', async () => {
  const footer = (on) => loadModule('src/components/site-footer.tsx', { env, stubs: stubs(on) });
  const links = (groups) => groups.flatMap((group) => group.links);
  const off = footer([]);
  assert.equal(links(off.footerGroups()).some((link) => link.href === PATH), false);
  assert.deepEqual(plain(off.footerGroups(new Set())), plain(off.footerGroups()));
  const product = off.footerGroups(MCP).find((group) => group.id === 'product');
  assert.deepEqual(plain(product.links.find((link) => link.href === PATH)), { href: PATH, label: 'חיבור לעוזרי AI' });
  assert.deepEqual(plain(off.footerGroups(MCP).map((group) => group.id)), plain(off.footerGroups().map((group) => group.id)));
  assert.equal(links(off.footerGroups(MCP)).length, links(off.footerGroups()).length + 1);
  const offHtml = render(await off.SiteFooter());
  const onHtml = render(await footer(['mcp']).SiteFooter());
  assert.equal(offHtml.includes(`href="${PATH}"`), false);
  assert.ok(onHtml.includes(`href="${PATH}"`));
  assert.equal(onHtml.replace(/<li><a href="\/ai">[^<]*<\/a><\/li>/, ''), offHtml, 'the link is the only difference');
});

// ---- /mcp is an API ----
test('isPrivatePath: /mcp is treated exactly like /api, and look-alike paths are untouched', () => {
  const site = loadModule('src/lib/seo/site.ts', { env });
  for (const path of ['/mcp', '/mcp/x', '/mcp/x/y']) for (const hasSession of [false, true]) assert.equal(site.isPrivatePath(path, hasSession), true, `${path} ${hasSession}`);
  for (const path of ['/mcpx', '/mcp-x', '/mcpshop', '/ai', '/ai/x', '/']) assert.equal(site.isPrivatePath(path), false, path);
  for (const path of ['/api', '/api/x']) assert.equal(site.isPrivatePath(path), true, path);
  assert.equal(site.isPrivatePath('/apix'), false);
  assert.deepEqual(plain(site.apiPrefixes), ['/api', '/mcp']);
  const { normalizeIndexNowUrls } = loadModule('src/lib/seo/indexnow.ts', { env });
  assert.deepEqual(plain(normalizeIndexNowUrls([`${ORIGIN}/mcp`, `${ORIGIN}/mcp/x`, `${ORIGIN}${PATH}`])), [`${ORIGIN}${PATH}`], 'IndexNow skips the endpoint');
});

test('the proxy marks /mcp noindex like any other private path', () => {
  const source = readFileSync(`${projectRoot}/src/proxy.ts`, 'utf8');
  assert.match(source, /isPrivatePath\(request\.nextUrl\.pathname, hasSession\)/);
});

test('reserved handles: ai and mcp can never be claimed as an agency page', () => {
  const { isReservedHandle, RESERVED_ROUTE_SEGMENTS } = loadModule('src/lib/headhunters/reserved.ts');
  for (const segment of ['ai', 'mcp']) { assert.ok(RESERVED_ROUTE_SEGMENTS.includes(segment), segment); assert.equal(isReservedHandle(segment), true, segment); }
  assert.equal(isReservedHandle('mcpshop'), false);
});
