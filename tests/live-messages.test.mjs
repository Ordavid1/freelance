import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadModule } from './helpers/load-ts.mjs';
import { documentFor } from './helpers/html.mjs';

test('legacy message bookmarks redirect into the live workspace and preserve opaque conversation IDs', async () => {
  const { default: page } = loadModule('src/app/messages/page.tsx', { stubs: { 'next/navigation': { redirect(url) { throw new Error(url); } } } });
  await assert.rejects(page({ searchParams: Promise.resolve({ conversation: 'abc&next=legacy' }) }), { message: '/?view=messages&conversation=abc%26next%3Dlegacy' });
  await assert.rejects(page({ searchParams: Promise.resolve({}) }), { message: '/?view=messages' });
});

test('analysis renders two live charts and a text conclusion, including truthful missing data', () => {
  const { CompatibilityAnalysisCard } = loadModule('src/components/compatibility-analysis.tsx');
  for (const score of [null, 75]) {
    const metric = { score, matched: score === null ? 0 : 3, total: score === null ? 0 : 4, matches: [], note: 'details' };
    const html = renderToStaticMarkup(createElement(CompatibilityAnalysisCard, { analysis: { score, label: 'בדיקה', skills: metric, experience: metric, conclusion: 'מסקנה אמיתית' } }));
    const doc = documentFor(html);
    assert.equal(doc.querySelectorAll('.analysis-chart').length, 2);
    assert.equal(doc.querySelectorAll('svg').length, 1);
    assert.equal(doc.querySelectorAll('img').length, 0);
    assert.equal(doc.querySelector('.analysis-summary p').textContent, 'מסקנה אמיתית');
    assert.equal(doc.querySelectorAll('button[aria-expanded="false"]').length, 2);
    if (score === null) assert.equal(doc.querySelectorAll('[aria-valuenow]').length, 0);
  }
});
