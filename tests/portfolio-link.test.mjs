import test from 'node:test';
import assert from 'node:assert/strict';
import { loadModule } from './helpers/load-ts.mjs';

const { portfolioLink } = loadModule('src/lib/profile/portfolio-link.ts');

test('portfolio links normalize HTTP(S) candidates while retaining prose support', () => {
  const link = portfolioLink('My project | https://EXAMPLE.com/path?q=1');
  assert.equal(link.href, 'https://example.com/path?q=1');
  assert.equal(link.hostname, 'example.com');
  assert.equal(portfolioLink('http://example.com').href, 'http://example.com/');
});

test('malformed, credentialed, and active-scheme entries remain editable text', () => {
  for (const entry of ['https://[', 'https://', 'https://user:password@example.com/', 'javascript:alert(1)', 'data:text/html,<script>alert(1)</script>', 'just text']) {
    assert.equal(portfolioLink(entry), null, entry);
  }
  assert.equal(portfolioLink('https://example.com/" onerror=alert(1)').href, 'https://example.com/');
});
