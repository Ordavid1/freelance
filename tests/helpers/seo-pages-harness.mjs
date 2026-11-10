// Shared helpers for the guide and information page tests: load a route or component with the
// UI stubs it needs, render it to static markup and read the result back (outline, ids, anchors,
// <time> values, visible FAQ text, JSON-LD) without a browser or a Next.js server.
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadModule } from './load-ts.mjs';

export const ORIGIN = 'https://freelance-place.com';
export const baseEnv = { SITE_INDEXABLE: 'true', NEXT_PUBLIC_SITE_URL: ORIGIN };
export const billingOnEnv = { ...baseEnv, BILLING_ENABLED: 'true', CARDCOM_TERMINAL_NUMBER: '1', CARDCOM_API_NAME: 'x' };
export const plain = (value) => JSON.parse(JSON.stringify(value));

// The shared loader's next/link and next/image stubs lack __esModule, so default imports would
// resolve to the wrapper object; these proper module stubs render real anchors and images.
const link = { __esModule: true, default: ({ href, children, prefetch, ...rest }) => createElement('a', { href, ...rest }, children) };
const image = { __esModule: true, default: ({ src, alt, width, height }) => createElement('img', { src, alt, width, height }) };
export const uiStubs = { 'next/link': link, 'next/image': image };
// The registry and the routes import the guide data through different specifiers; both get the same list.
export const guideStubs = (guides) => ({ '@/lib/seo/guides': { guides }, './guides': { guides } });

export function load(entry, { env = baseEnv, guides, stubs = {} } = {}) {
  return loadModule(entry, { env, stubs: { ...uiStubs, ...(guides ? guideStubs(guides) : {}), ...stubs } });
}
export const render = (element) => renderToStaticMarkup(element);
export { createElement };

// ---- reading markup back ----
const ENTITIES = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#x27;': "'", '&#39;': "'" };
export const decode = (value) => value.replace(/&(?:amp|lt|gt|quot|#x27|#39);/g, (entity) => ENTITIES[entity]);
export const text = (html) => decode(html.replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
export const count = (html, pattern) => (html.match(pattern) || []).length;
export const jsonLd = (html) => [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((match) => JSON.parse(match[1]));
export const ofType = (html, type) => jsonLd(html).filter((node) => node['@type'] === type);
export const ids = (html) => [...html.replace(/<script[\s\S]*?<\/script>/g, '').matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
export const headings = (html, level) => [...html.matchAll(new RegExp(`<h${level}[ >][\\s\\S]*?</h${level}>`, 'g'))].map((match) => decode(match[0].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim());

export function indexOfOrFail(html, needle) {
  const index = html.indexOf(needle);
  assert.notEqual(index, -1, `expected the markup to contain ${needle}`);
  return index;
}
export function assertInOrder(html, needles, message = 'blocks appear in the expected order') {
  const positions = needles.map((needle) => indexOfOrFail(html, needle));
  assert.deepEqual([...positions].sort((a, b) => a - b), positions, `${message}: ${needles.join(' < ')}`);
}
export function sectionHtml(html, id) {
  const start = indexOfOrFail(html, `<section id="${id}"`);
  return html.slice(start, html.indexOf('</section>', start) + '</section>'.length);
}
// The questions of the FAQ block (details/summary) and of the grouped FAQ page, as [question, answer].
export const detailsFaq = (html) => [...html.matchAll(/<details><summary>([\s\S]*?)<\/summary><p>([\s\S]*?)<\/p><\/details>/g)].map((m) => [decode(m[1]), decode(m[2])]);
export const groupedFaq = (html) => [...html.matchAll(/<div id="q-\d+-\d+" class="ga-qa"><h3>([\s\S]*?)<\/h3><p>([\s\S]*?)<\/p><\/div>/g)].map((m) => [decode(m[1]), decode(m[2])]);
export const faqPairs = (node) => node.mainEntity.map((entry) => [entry.name, entry.acceptedAnswer.text]);
// The ISO date inside the byline's <time> and the text shown next to it.
export function bylineTime(html) {
  const match = /<p class="ga-byline">[\s\S]*?<time dateTime="([^"]+)">([^<]*)<\/time>/.exec(html);
  return match ? { iso: match[1], shown: match[2] } : null;
}

// ---- structural rules every long-form page must satisfy ----
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
export function assertWellFormed(html, label, formatHebrewDate) {
  assert.equal(count(html, /<h1[ >]/g), 1, `${label}: exactly one h1`);
  for (const level of [1, 2, 3]) for (const heading of headings(html, level)) assert.ok(heading.length > 0, `${label}: no empty h${level}`);
  const all = ids(html);
  const duplicated = all.filter((id, index) => all.indexOf(id) !== index);
  assert.deepEqual(duplicated, [], `${label}: element ids are unique`);
  for (const [, fragment] of html.matchAll(/href="#([^"]+)"/g)) assert.ok(all.includes(fragment), `${label}: #${fragment} points at an element`);
  for (const [, labelledBy] of html.matchAll(/aria-labelledby="([^"]+)"/g)) assert.ok(all.includes(labelledBy), `${label}: aria-labelledby ${labelledBy} resolves`);
  for (const [, iso, shown] of html.matchAll(/<time dateTime="([^"]+)">([^<]*)<\/time>/g)) {
    assert.match(iso, ISO_DATE, `${label}: <time> carries an ISO date`);
    if (formatHebrewDate) assert.equal(shown, formatHebrewDate(iso), `${label}: visible date matches its dateTime`);
  }
  assert.ok(count(jsonLd(html).map((node) => node['@type']).join(' '), /FAQPage/g) <= 1, `${label}: at most one FAQPage`);
  for (const [, href] of html.matchAll(/<a [^>]*href="([^"]+)"/g)) assert.match(href, /^(\/|#|mailto:|https:\/\/)/, `${label}: link ${href} is internal, mailto or https`);
  assert.doesNotMatch(html, /localhost|javascript:/, `${label}: no localhost or javascript: URL`);
}

// ---- structured-data policy (same rules as seo-schema.test.mjs, applied to rendered pages) ----
const FORBIDDEN_TYPES = ['JobPosting', 'Review', 'AggregateRating', 'Rating'];
const FORBIDDEN_KEYS = ['aggregateRating', 'review', 'reviewRating', 'ratingValue', 'ratingCount', 'reviewCount', 'baseSalary', 'jobLocation', 'hiringOrganization'];
export function walk(value, visit, key = '') {
  visit(value, key);
  if (Array.isArray(value)) value.forEach((item) => walk(item, visit, key));
  else if (value && typeof value === 'object') Object.entries(value).forEach(([childKey, child]) => walk(child, visit, childKey));
}
export function assertStructuredDataPolicy(nodes, label) {
  const urlKeys = new Set(['url', 'item', '@id', 'mainEntityOfPage', 'image']);
  for (const node of nodes) {
    walk(node, (value, key) => {
      if (key === '@type') for (const type of [].concat(value)) assert.ok(!FORBIDDEN_TYPES.includes(type), `${label}: emits ${type}`);
      assert.ok(!FORBIDDEN_KEYS.includes(key), `${label}: emits ${key}`);
      if (typeof value === 'string' && urlKeys.has(key)) assert.ok(value === ORIGIN || value.startsWith(`${ORIGIN}/`), `${label}: ${key} is absolute on the site origin: ${value}`);
    });
  }
}
// An @id names one entity: a node that carries more than the id is a definition, and two definitions
// with the same id would merge different things into one. References ({ "@id": ... } alone) are free.
export function assertUniqueNodeIds(nodes, label) {
  const defined = [];
  for (const node of nodes) {
    walk(node, (value) => {
      const isNode = value && typeof value === 'object' && !Array.isArray(value) && typeof value['@id'] === 'string';
      if (isNode && Object.keys(value).some((key) => key !== '@id' && key !== '@context')) defined.push(value['@id']);
    });
  }
  assert.deepEqual(defined.filter((id, index) => defined.indexOf(id) !== index), [], `${label}: every @id is defined once`);
}
export const jsonTypes = (html) => jsonLd(html).map((node) => node['@type']).sort();
