import test from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadModule } from './helpers/load-ts.mjs';

test('loader resolves project imports and exposes runtime env per load', () => {
  const production = loadModule('src/lib/seo/site.ts', { env: { SITE_INDEXABLE: 'true' } });
  const preview = loadModule('src/lib/seo/site.ts', { env: {} });
  assert.equal(production.indexingEnabled(), true);
  assert.equal(preview.indexingEnabled(), false);
  assert.equal(production.absoluteUrl('/guides'), 'https://freelance-place.com/guides');
});

test('loader renders server components with real React and default Next stubs', () => {
  const { Questions } = loadModule('src/components/discovery/public-content.tsx');
  const html = renderToStaticMarkup(Questions({ items: [{ question: 'שאלה?', answer: 'תשובה.' }] }));
  assert.match(html, /<details><summary>שאלה\?<\/summary><p>תשובה\.<\/p><\/details>/);
  assert.match(html, /application\/ld\+json/);
});

test('loader refuses unstubbed packages so tests cannot reach real services', () => {
  assert.throws(() => loadModule('src/lib/seo/projects.ts'), /Unexpected dependency: firebase-admin\/firestore/);
});
