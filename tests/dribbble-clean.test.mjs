import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { loadModule } from './helpers/load-ts.mjs';

const { cleanDribbbleText } = loadModule('src/lib/integrations/dribbble.ts', {
  stubs: { 'node:crypto': { randomBytes } },
});

test('Dribbble HTML conversion ignores scripts, styles, and their nonstandard end tags', () => {
  assert.equal(cleanDribbbleText('Hello <b>עולם</b> &amp; friends'), 'Hello עולם & friends');
  for (const close of ['</script>', '</SCRIPT data-extra>', '</script/>']) {
    assert.equal(cleanDribbbleText(`<p>before</p><script>CANARY${close}<p>after</p>`), 'before after');
  }
  assert.equal(cleanDribbbleText('before <style>CANARY</style data-extra> after'), 'before after');
  assert.equal(cleanDribbbleText('a<!-- hidden --!>b'), 'ab');
});

test('Dribbble entities decode once into plain text without a recursive unescape', () => {
  assert.equal(cleanDribbbleText('&amp;lt;b&amp;gt;literal&amp;lt;/b&amp;gt;'), '&lt;b&gt;literal&lt;/b&gt;');
  assert.equal(cleanDribbbleText('&lt;b&gt;literal&lt;/b&gt;'), '<b>literal</b>');
  assert.equal(cleanDribbbleText('1 &lt; 2 &amp; 3 &gt; 2'), '1 < 2 & 3 > 2');
  assert.equal(cleanDribbbleText(null), '');
});

test('Dribbble conversion bounds hostile raw input before parsing and caps the result', () => {
  assert.equal(cleanDribbbleText('a'.repeat(30_000) + 'OUTSIDE_WINDOW', 40_000), 'a'.repeat(30_000));
  assert.equal(cleanDribbbleText('abcdef', 3), 'abc');
  const start = performance.now();
  cleanDribbbleText('<a'.repeat(500_000));
  assert.ok(performance.now() - start < 1000, 'bounded conversion must not scan an unbounded hostile string');
});
