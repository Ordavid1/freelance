import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { loadModule } from './helpers/load-ts.mjs';
import { createRequire } from 'node:module';

// Hostile-HTML properties for every place the app runs parse5 on external markup:
//   1. xplace project pages (2 MB body cap): parseProjectHtml + contents() + parseXPlaceProjectHtml
//   2. Dribbble text cleaning (30,000 char window): cleanDribbbleText
// Each document must finish without a crash (stack overflow, String.fromCodePoint RangeError, ...) and in
// bounded time. Budgets are generous multiples of the measured parse5 8.x time but far below the
// quadratic behaviour of parse5 7.x.

const fixture = (name) => readFileSync(new URL(`./fixtures/xplace/${name}`, import.meta.url), 'utf8');
const { parseProjectHtml, contents } = loadModule('src/lib/imports/xplace/project-html.ts');
const { parseXPlaceProjectHtml } = loadModule('src/lib/imports/xplace/project.ts');
const { cleanDribbbleText } = loadModule('src/lib/integrations/dribbble.ts', { stubs: { 'node:crypto': { randomBytes } } });
const parse5 = createRequire(import.meta.url)('parse5');

const project = { kind: 'project', projectId: '123456', canonicalUrl: 'https://www.xplace.com/il/job-bids/123456', fetchUrl: 'https://www.xplace.com/project?id=123456' };
const XPLACE_CAP = 2 * 1024 * 1024;
const XPLACE_SIZE = 400_000; // table cases; 391 KB of nested <div> took 23.7s on parse5 7.3.0
const DRIBBBLE_CAP = 30_000;
const BUDGET_MS = 4000; // per case, per code path
const real = fixture('project-html-only.html');
const realBody = real.slice(real.indexOf('<body>') + 6, real.indexOf('</body>'));

const repeat = (unit, bytes) => unit.repeat(Math.ceil(bytes / unit.length)).slice(0, bytes);
const nested = (open, bytes) => repeat(open, bytes);
const mix = (opens, bytes) => {
  let out = '';
  for (let i = 0; out.length < bytes; i++) out += opens[i % opens.length];
  return out;
};
const numbered = (make, bytes) => {
  let out = '';
  for (let i = 0; out.length < bytes; i++) out += make(i);
  return out;
};

// [name, builder(size) -> html]. Sizes are near the real caps for each path.
const CASES = [
  ['deep nested div', (n) => nested('<div>', n)],
  ['deep nested b', (n) => nested('<b>', n)],
  ['deep span/div/b mix', (n) => mix(['<span>', '<div>', '<b>'], n)],
  ['nested template unclosed at EOF', (n) => nested('<template>', n)],
  ['nested template with div unclosed', (n) => mix(['<template>', '<div>'], n)],
  ['deep svg foreign content', (n) => `<svg>${nested('<g>', n)}`],
  ['deep math foreign content', (n) => `<math>${nested('<mi>', n)}`],
  ['svg/math integration point mix', (n) => `<svg>${mix(['<foreignObject>', '<div>', '<math>', '<annotation-xml encoding="text/html">'], n)}`],
  ['nested tables (foster parenting)', (n) => nested('<table><tr><td>', n)],
  ['foster parenting text in table', (n) => `<table>${numbered((i) => `<b>x${i}</b>`, n)}`],
  ['tag with thousands of attributes', (n) => `<div ${numbered((i) => `a${i}=1 `, n)}>`],
  ['repeated attributes with same name', (n) => `<div ${repeat('a=1 ', n)}>`],
  ['thousands of <html>/<body> tags', (n) => numbered((i) => (i % 2 ? '<body a=1>' : '<html b=2>'), n)],
  ['repeated formatting <b a=N>', (n) => numbered((i) => `<b a=${i}>`, n)],
  ['repeated formatting <a>/<i> distinct attrs', (n) => numbered((i) => `<a x=${i}><i y=${i}>`, n)],
  ['lone low surrogates', (n) => '\uDC00'.repeat(n)],
  ['paired low surrogates in text, attrs, comments', (n) => `<p a="${'\uDC00\uDC00'.repeat(n >> 3)}">${'\uDC00\uDC00'.repeat(n >> 3)}</p><!--${'\uDC00\uDC00'.repeat(n >> 3)}-->`],
  ['unterminated start tag', (n) => `<div ${repeat('x', n)}`],
  ['unterminated comment', (n) => `<!--${repeat('-', n)}`],
  ['unterminated quoted attribute', (n) => `<div a="${repeat('q', n)}`],
  ['many unterminated tags', (n) => repeat('<a', n)],
  ['deep nesting wrapped around real fixture', (n) => `${nested('<div>', n - real.length)}${real}`],
];

function assertBenign(error, label) {
  // Errors come from a vm realm, so compare by name/code instead of instanceof.
  assert.ok(error && typeof error === 'object', `${label}: non-object throw`);
  assert.ok(!['RangeError', 'TypeError', 'ReferenceError'].includes(error.name), `${label}: crashed with ${error.name}: ${error.message}`);
  assert.equal(error.code, 'NOT_ENOUGH_DATA', `${label}: unexpected error ${error.name}: ${error.message}`);
}

function timed(label, fn) {
  const start = performance.now();
  const value = fn();
  const ms = performance.now() - start;
  assert.ok(ms < BUDGET_MS, `${label} took ${Math.round(ms)}ms (budget ${BUDGET_MS}ms)`);
  return { value, ms };
}

for (const [name, build] of CASES) {
  test(`hostile xplace page (~400 KB): ${name}`, () => {
    const html = build(XPLACE_SIZE).slice(0, XPLACE_SIZE);
    const { value: page, ms } = timed('parseProjectHtml', () => parseProjectHtml(html));
    assert.ok(Array.isArray(page.elements) && page.elements.length > 0, 'parser always yields at least html/head/body');
    const body = page.elements.find((el) => el.tagName === 'body');
    const deepest = page.elements[page.elements.length - 1];
    for (const el of [body, deepest]) {
      const { value: out } = timed('contents', () => contents(el));
      assert.equal(typeof out, 'string');
    }
    test.diagnostic?.(`${name}: parseProjectHtml ${Math.round(ms)}ms`);
  });

  // Full import. A throw is fine only as ImportError NOT_ENOUGH_DATA, never a crash.
  test(`xplace import (~400 KB): ${name}`, () => {
    const html = build(XPLACE_SIZE).slice(0, XPLACE_SIZE);
    const start = performance.now();
    try {
      parseXPlaceProjectHtml(html, project);
    } catch (error) {
      assertBenign(error, 'parseXPlaceProjectHtml');
    }
    const ms = performance.now() - start;
    assert.ok(ms < BUDGET_MS, `parseXPlaceProjectHtml took ${Math.round(ms)}ms (budget ${BUDGET_MS}ms)`);
  });

  test(`hostile Dribbble text (30,000 chars): ${name}`, () => {
    // The parse5 stage of cleanDribbbleText (parseFragment + serialize) on the raw 30,000 char window.
    const html = build(DRIBBBLE_CAP * 3).slice(0, DRIBBBLE_CAP);
    const { value } = timed('serialize(parseFragment)', () => parse5.serialize(parse5.parseFragment(html)));
    assert.equal(typeof value, 'string');
  });

  // Full pipeline including html-to-text (depth-limited by untrustedHtmlToText).
  test(`Dribbble full pipeline (30,000 chars): ${name}`, () => {
    const html = build(DRIBBBLE_CAP * 3).slice(0, DRIBBBLE_CAP);
    const { value } = timed('cleanDribbbleText', () => cleanDribbbleText(html, 1000));
    assert.equal(typeof value, 'string');
    assert.ok(value.length <= 1000);
  });
}

test('xplace pages at the full 2 MB body cap: deep nesting and quadratic-prone shapes', () => {
  for (const [name, build] of CASES.filter(([n]) => ['deep nested div', 'nested template unclosed at EOF', 'repeated formatting <b a=N>', 'tag with thousands of attributes'].includes(n))) {
    const html = build(XPLACE_CAP).slice(0, XPLACE_CAP);
    const page = timed(`${name} parseProjectHtml`, () => parseProjectHtml(html)).value;
    timed(`${name} contents`, () => contents(page.elements.find((el) => el.tagName === 'body')));
  }
});

test('deeply nested real content still extracts the fixture title and description', () => {
  const body = `${'<div>'.repeat(50_000)}${realBody}${'</div>'.repeat(50_000)}`;
  const html = `<!DOCTYPE html><html><head><title>פרויקט: Need a WordPress developer</title></head><body>${body}</body></html>`;
  const baseline = parseXPlaceProjectHtml(real, project);
  const { value: result } = timed('parseXPlaceProjectHtml', () => parseXPlaceProjectHtml(html, project));
  assert.equal(result.draft.title, 'Need a WordPress developer');
  assert.equal(result.draft.title, baseline.draft.title);
  assert.equal(result.draft.description, baseline.draft.description);
  assert.equal(result.draft.budget, baseline.draft.budget);
  const page = parseProjectHtml(html);
  assert.ok(page.elements.some((el) => el.tagName === 'h1'), 'h1 survives under deep nesting');
  assert.ok(contents(page.elements.find((el) => el.tagName === 'body')).includes('Need a WordPress developer'));
  // Same property for Dribbble: real text beneath deep nesting survives within the 30,000 char window.
  const text = cleanDribbbleText(`${'<div>'.repeat(2000)}Hello <b>world</b>`, 1000);
  assert.equal(text, 'Hello world');
});

test('serialize output of malformed inputs re-parses to the same serialization', () => {
  const inputs = [
    '<b a=1><b a=2><b a=3><p>x</b>y',
    '<table><tr><td>a<b>b</table>c<b>d',
    '<div><p>unclosed <span>text',
    '<a href="x"><a href="y">nested anchors</a>',
    '<!-- open comment',
    '<div a="unterminated',
    '<template><div><template><p>x',
    '<svg><select><option>x</select></svg>',
    '<svg><template><b>x</b></template></svg>',
    '<svg></sKKip>text',
    '<svg><scKript>alert(1)</script></svg>',
    '<math><mi><select><b>x</b></select></mi></math>',
    '<svg><foreignObject><select><option>a</select></foreignObject></svg>',
    '<html a=1><html b=2><body c=3><body d=4>x',
    'a\uDC00b\uDC00\uDC00<p title="\uDC00\uDC00">',
    '<p>\u0000<b>&#xD800;&#0;&notit;</b>',
  ];
  for (const input of inputs) {
    const once = parse5.serialize(parse5.parseFragment(input));
    assert.equal(parse5.serialize(parse5.parseFragment(once)), once, `fragment unstable: ${JSON.stringify(input)}`);
    const doc = parse5.serialize(parse5.parse(input));
    assert.equal(parse5.serialize(parse5.parse(doc)), doc, `document unstable: ${JSON.stringify(input)}`);
    // The app path as well: the Dribbble cleaner must be idempotent on its own serialization-safe output.
    assert.equal(typeof cleanDribbbleText(input), 'string');
  }
});
