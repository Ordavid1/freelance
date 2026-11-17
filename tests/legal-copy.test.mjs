import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadModule, projectRoot } from './helpers/load-ts.mjs';

const identity = loadModule('src/lib/legal/identity.ts');
const read = (path) => readFileSync(`${projectRoot}/${path}`, 'utf8');

test('the date printed on the legal pages is derived from legalUpdated, never typed twice', () => {
  assert.match(identity.legalUpdated, /^\d{4}-\d{2}-\d{2}$/);
  // Node's own Hebrew month names are the reference for all twelve months.
  for (let month = 0; month < 12; month++) {
    const iso = `2026-${String(month + 1).padStart(2, '0')}-17`;
    const reference = new Date(Date.UTC(2026, month, 17)).toLocaleDateString('he-IL', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
    assert.equal(identity.formatLegalDate(iso), reference, iso);
  }
  assert.equal(identity.legalUpdatedLabel, identity.formatLegalDate(identity.legalUpdated));
  const component = read('src/components/legal-document.tsx');
  assert.match(component, /<time dateTime=\{legalUpdated\}>\{legalUpdatedLabel\}<\/time>/);
  assert.doesNotMatch(component, /\d{1,2} ב(?:ינואר|פברואר|מרץ|אפריל|מאי|יוני|יולי|אוגוסט|ספטמבר|אוקטובר|נובמבר|דצמבר) \d{4}/, 'a literal date beside the derived one can drift');
});

test('the Terms call AI-agent projects samples and no longer offer practice proposals on them', () => {
  const terms = read('src/app/terms/page.tsx');
  assert.match(terms, /פרויקטים המסומנים כפרויקטים של סוכן AI הם פרויקטים לדוגמה ואינם הזדמנות עבודה אצל לקוח אנושי\./);
  // Every sample project is closed, so nobody can file a practice proposal on one; the Terms must not promise it.
  assert.doesNotMatch(terms, /הצעת תרגול|אפשר לשמור עליהם/);
});
