import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadModule } from './helpers/load-ts.mjs';

const { cleanText } = loadModule('src/lib/imports/xplace/clean.ts');

test('server text cleaning follows the shared extension conformance corpus', () => {
  const cases = JSON.parse(readFileSync(new URL('./fixtures/xplace/text-cleaning.json', import.meta.url), 'utf8'));
  for (const { input, expected } of cases) assert.equal(cleanText(input, 1000), expected, input);
});

test('hostile unterminated markup is cleaned in linear time', () => {
  for (const input of ['<a'.repeat(20000), '<!--'.repeat(10000), '<'.repeat(30000), '<script '.repeat(8000), '<style>'.repeat(8000), '</script   '.repeat(5000), '<script>' + '</script '.repeat(10000), '<style>' + '</style '.repeat(10000), '<a '.repeat(10000) + '>']) {
    const started = performance.now();
    const out = cleanText(input, 100_000);
    const ms = performance.now() - started;
    assert.ok(ms < 100, `${input.slice(0, 12)} took ${ms}ms`);
    assert.equal(typeof out, 'string');
  }
});

test('unterminated tags and comments stay literal text, terminated ones are removed', () => {
  assert.equal(cleanText('a <b and 2 < 3', 100), 'a <b and 2 < 3');
  assert.equal(cleanText('x <!-- never closed', 100), 'x <!-- never closed');
  assert.equal(cleanText('x <!-- gone --> y', 100), 'x y');
  assert.equal(cleanText('<p>Hello <b>World</b></p><br/>', 100), 'Hello World');
  assert.equal(cleanText('before <script type="x">evil()</script> after', 100), 'before after');
  assert.equal(cleanText('a <style>p{}</STYLE>b <scripty>c</scripty>', 100), 'a b c');
  assert.equal(cleanText('1 < 2 and <b>bold</b>', 100), '1 < 2 and bold');
});

test('entity-encoded tags are still stripped', () => {
  assert.equal(cleanText('&lt;script&gt;alert(1)&lt;/script&gt;Plain', 100), 'Plain');
  assert.equal(cleanText('&lt;b&gt;bold&lt;/b&gt; text', 100), 'bold text');
  assert.equal(cleanText('&#60;img src=x&#62;ok', 100), 'ok');
});
