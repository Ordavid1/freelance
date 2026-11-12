// Optional end-to-end run (not part of `npm test`): loads dist-dev/ in a persistent Chromium context with routed fixtures.
// Usage: npm run build:dev && node tests/e2e/run.mjs   (needs `playwright` and a cached Chromium)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const here = path.dirname(fileURLToPath(import.meta.url));
const ext = path.resolve(here, '../../dist-dev');
const profileHtml = fs.readFileSync(path.resolve(here, '../fixtures/profile-own.html'), 'utf8');
const exe = process.env.CHROMIUM_PATH || chromium.executablePath();

const userDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fpx-e2e-'));
const ctx = await chromium.launchPersistentContext(userDir, {
  headless: process.env.HEADLESS === '1', executablePath: exe,
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
});
let failed = false;
const check = (ok, label) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${label}`); if (!ok) failed = true; };
try {
  await ctx.route('https://www.xplace.com/**', (r) => r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: profileHtml }));
  await ctx.route('http://localhost:3000/**', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>fp</title><body>Freelance Place</body>' }));
  let [sw] = ctx.serviceWorkers();
  if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 15000 });

  const page = await ctx.newPage();
  await page.goto('https://www.xplace.com/il/u/dana-design');
  await page.waitForSelector('#fp-xplace-import-host', { state: 'attached', timeout: 10000 });
  check(true, 'invitation host attached on XPlace');
  const pre = await sw.evaluate(() => chrome.storage.session.get(null));
  check(Object.keys(pre).length === 0, 'nothing staged before the click');

  // The shadow root is closed: click the CTA by geometry (it sits above the last row of the card, inside the host box).
  const box = await page.evaluate(() => { const r = document.getElementById('fp-xplace-import-host').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
  const opened = ctx.waitForEvent('page', { timeout: 20000 });
  await page.mouse.click(box.x + box.w / 2, box.y + box.h - 80);
  const fpPage = await opened;
  await fpPage.waitForURL(/localhost:3000/, { timeout: 10000 }).catch(() => {});
  await fpPage.waitForLoadState('domcontentloaded').catch(() => {});
  const url = fpPage.url();
  console.log('tab url', url, await fpPage.title().catch(() => ''));
  check(/^http:\/\/localhost:3000\/profile\/import\?xplace=[0-9a-f-]{36}$/.test(url), `hand-off tab opened: ${url}`);
  const staged = await sw.evaluate(() => chrome.storage.session.get(null));
  const entry = Object.values(staged)[0];
  check(entry && entry.payload && entry.payload.kind === 'profile' && !JSON.stringify(entry).includes('CANARY'), 'payload staged, no canaries');
  const marker = await fpPage.evaluate(() => document.documentElement.getAttribute('data-fp-xplace-extension'));
  check(marker === '0.2.1', `bridge marker attribute ${marker}`);
  const reply = await fpPage.evaluate((token) => new Promise((resolve) => {
    window.addEventListener('message', (e) => { if (e.data && e.data.channel === 'fp-xplace-response') resolve(e.data); });
    window.postMessage({ channel: 'fp-xplace-request', token, action: 'read' }, location.origin);
    setTimeout(() => resolve(null), 5000);
  }), new URL(url).searchParams.get('xplace'));
  check(reply && reply.payload && reply.payload.kind === 'profile' && reply.payload.headline.includes('UX'), 'page reads the payload through the bridge');
} catch (e) {
  console.log('E2E ERROR', e.message); failed = true;
} finally {
  await ctx.close();
  fs.rmSync(userDir, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
