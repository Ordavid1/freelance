import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadModule, projectRoot } from './helpers/load-ts.mjs';

const plain = (value) => JSON.parse(JSON.stringify(value));
const load = (entry, env = { SITE_INDEXABLE: 'true' }) => loadModule(entry, { env: { SITE_INDEXABLE: 'true', ...env } });
const factsModule = load('src/lib/seo/facts.ts');
const registry = load('src/lib/seo/registry.ts');

// The shared loader's next/link stub lacks __esModule, so default imports resolve to the wrapper object; use a proper module stub for rendering.
const linkStub = { 'next/link': { __esModule: true, default: ({ href, children }) => createElement('a', { href }, children) } };
const footer = loadModule('src/components/site-footer.tsx', { stubs: linkStub, env: { SITE_INDEXABLE: 'true' } });

test('footer renders every link group from the registry with resolvable links and no empty groups', () => {
  const groups = footer.footerGroups();
  const known = new Set(registry.allPages().map((page) => page.path));
  assert.ok(registry.indexablePages().some((page) => page.kind === 'skill'), 'the catalogue holds at least one indexable skill page (wordpress is the reference entry)');
  assert.deepEqual(plain(groups.map((group) => group.id)), ['categories', 'skills', 'guides', 'product', 'legal'], 'the skills group appears once a skill page is registered and indexable');
  for (const group of groups) {
    assert.ok(group.links.length > 0, `${group.id} is not empty`);
    for (const link of group.links) {
      assert.ok(link.label.trim().length > 0);
      if (link.href.startsWith('mailto:')) assert.equal(link.href, `mailto:${factsModule.contactFacts().email}`);
      else assert.ok(known.has(link.href), `${link.href} is a registry path`);
    }
  }
  const html = renderToStaticMarkup(footer.SiteFooter());
  assert.match(html, /^<footer class="site-footer">/);
  for (const href of ['/categories/design', '/guides/project-brief', '/alternatives/xplace', '/privacy', '/terms', `mailto:${factsModule.contactFacts().email}`]) {
    assert.ok(html.includes(`href="${href}"`), href);
  }
  assert.doesNotMatch(html, /<ul><\/ul>/);
  assert.doesNotMatch(html, /<h[1-6]/, 'the footer does not add headings to the page outline');
  assert.match(html, /aria-labelledby="footer-categories"/);
});

test('footer shows indexable skills only, capped, and the guide group is capped too', () => {
  const longText = Array.from({ length: 60 }, (_, index) => `מילה${index}`).join(' ');
  const skill = (n, complete = true) => ({ slug: `skill-${n}`, name: `כישור ${n}`, aliases: [], category: 'design', title: `כישור לבדיקת כותרת ארוכה ${n}`, description: 'ת'.repeat(80), definition: longText, whenNeeded: longText, deliverables: complete ? ['א', 'ב', 'ג', 'ד'] : [], howToChoose: ['א', 'ב', 'ג', 'ד'], priceDrivers: ['א', 'ב', 'ג'], questions: [{ question: longText, answer: longText }, { question: 'ש', answer: 'ת' }, { question: 'ש2', answer: 'ת2' }], related: [], published: '2026-11-01', modified: '2026-11-02' });
  const guide = (n) => ({ slug: `guide-${n}`, title: `מדריך לבדיקה בכותרת ארוכה ${n}`, description: 'ת'.repeat(80), audience: 'both', published: '2026-11-01', modified: '2026-11-02', summary: 'ס', sections: [], faq: [], related: [] });
  const skillsModule = load('src/lib/seo/skills.ts');
  const list = [...Array.from({ length: 10 }, (_, n) => skill(n)), skill(99, false)];
  const stubSkills = { skills: list, skillCompleteness: skillsModule.skillCompleteness };
  const stubGuides = { guides: Array.from({ length: 9 }, (_, n) => guide(n)) };
  const registryWithData = loadModule('src/lib/seo/registry.ts', { stubs: { './skills': stubSkills, './guides': stubGuides } });
  const filled = loadModule('src/components/site-footer.tsx', { stubs: { ...linkStub, '@/lib/seo/skills': stubSkills, '@/lib/seo/registry': registryWithData } });
  const groups = Object.fromEntries(filled.footerGroups().map((group) => [group.id, group]));
  assert.equal(groups.skills.links.length, 8);
  assert.equal(groups.skills.links.some((link) => link.href === '/skills/skill-99'), false);
  assert.equal(groups.guides.links.length, 6);
  assert.deepEqual(plain(filled.footerGroups().map((group) => group.id)), ['categories', 'skills', 'guides', 'product', 'legal']);
});

test('the footer does not hard-code the production origin or localhost', () => {
  assert.doesNotMatch(readFileSync(`${projectRoot}/src/components/site-footer.tsx`, 'utf8'), /freelance-place\.com|localhost/);
});

test('layout wires the footer, viewport theme colour and schema builders; the old footer is gone', () => {
  const layout = readFileSync(`${projectRoot}/src/app/layout.tsx`, 'utf8');
  assert.match(layout, /<SiteFooter \/>/);
  assert.match(layout, /export const viewport: Viewport = \{ themeColor: '#f4f6f2' \}/);
  assert.match(layout, /siteGraph\(\)/);
  assert.match(readFileSync(`${projectRoot}/src/app/globals.css`, 'utf8'), /--mineral:#f4f6f2/, 'theme colour is the page background');
  assert.doesNotMatch(readFileSync(`${projectRoot}/src/components/legal-document.tsx`, 'utf8'), /LegalFooter/);
  const legal = load('src/components/legal-document.tsx');
  const identity = load('src/lib/legal/identity.ts');
  assert.equal(legal.legalOperator, identity.legalOperator);
  assert.equal(legal.legalEmail, identity.legalEmail);
  assert.equal(legal.legalUpdated, identity.legalUpdated);
});
