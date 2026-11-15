import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadModule } from './helpers/load-ts.mjs';

const analytics = await import('../src/lib/analytics.ts');
const { canInstallExtension } = loadModule('src/lib/imports/xplace/handoff-client.ts');
const source = (file) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');

function withWindow(run) {
  const timers = [];
  const store = new Map();
  const localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => { store.set(k, String(v)); }, removeItem: (k) => { store.delete(k); } };
  const win = { dataLayer: [], localStorage, setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; } };
  globalThis.window = win;
  try { return run(win, timers); } finally { delete globalThis.window; }
}
const lastEvent = (win) => Array.from(win.dataLayer.at(-1));

test('a new account reports sign_up and a returning one reports login, both with the Google method', () => withWindow((win) => {
  void analytics.trackGoogleSignIn(true);
  let [command, name, params] = lastEvent(win);
  assert.equal(command, 'event');
  assert.equal(name, 'sign_up');
  assert.equal(params.method, 'Google');
  assert.equal(params.send_to, analytics.MEASUREMENT_ID);
  void analytics.trackGoogleSignIn(false);
  [, name, params] = lastEvent(win);
  assert.equal(name, 'login');
  assert.equal(params.method, 'Google');
}));

test('the pre-navigation event resolves when Google tag confirms the hit', async () => {
  let resolved = false;
  await withWindow(async (win) => {
    const pending = analytics.trackEventBeforeNavigation('sign_up', { method: 'Google' }, 900).then(() => { resolved = true; });
    const [, , params] = lastEvent(win);
    assert.equal(params.event_timeout, 900);
    params.event_callback();
    params.event_callback();
    await pending;
  });
  assert.equal(resolved, true);
});

test('the pre-navigation event still resolves when Google tag is blocked or never loads', async () => {
  await withWindow(async (_win, timers) => {
    const pending = analytics.trackEventBeforeNavigation('login', {}, 700);
    assert.equal(timers.length, 1);
    assert.equal(timers[0].ms, 700);
    timers[0].fn();
    await pending;
  });
});

test('a sign-up whose session setup failed is still reported as sign_up when the retry succeeds, exactly once', () => withWindow((win) => {
  // First attempt: Firebase creates the account (isNewUser true), then the site's session setup fails: nothing is tracked.
  assert.equal(analytics.beginGoogleSignIn('uid-1', true), true);
  // Retry: Firebase now reports an existing account, but the earlier attempt never reported the sign-up.
  const isNew = analytics.beginGoogleSignIn('uid-1', false);
  assert.equal(isNew, true);
  void analytics.trackGoogleSignIn(isNew, 'uid-1');
  assert.equal(lastEvent(win)[1], 'sign_up');
  // A later sign-in on the same account is a plain login: the sign-up is never counted twice.
  const later = analytics.beginGoogleSignIn('uid-1', false);
  assert.equal(later, false);
  void analytics.trackGoogleSignIn(later, 'uid-1');
  assert.equal(lastEvent(win)[1], 'login');
}));

test('a pending sign-up never turns another account into a sign-up', () => withWindow(() => {
  analytics.beginGoogleSignIn('uid-a', true);
  assert.equal(analytics.beginGoogleSignIn('uid-b', false), false);
}));

test('sign-in still works when browser storage is blocked', () => withWindow((win) => {
  win.localStorage = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); }, removeItem() { throw new Error('blocked'); } };
  assert.equal(analytics.beginGoogleSignIn('uid-1', true), true);
  assert.equal(analytics.beginGoogleSignIn('uid-1', false), false);
  void analytics.trackGoogleSignIn(true, 'uid-1');
  assert.equal(lastEvent(win)[1], 'sign_up');
}));

test('both Google sign-in paths report the result before leaving the page', () => {
  const header = source('src/components/auth-control.tsx');
  assert.match(header, /beginGoogleSignIn\(credential\.user\.uid, additional\?\.isNewUser === true\)/);
  assert.match(header, /await trackGoogleSignIn\(isNewUser, credential\.user\.uid\);\s*window\.location\.reload\(\);/);
  const form = source('src/components/sign-in-form.tsx');
  assert.match(form, /await trackGoogleSignIn\(isNewUser, authUser\.uid\);[\s\S]*window\.location\.assign\(safeNextPath\(next\)\)/);
  assert.match(form, /beginGoogleSignIn\(credential\.user\.uid, getAdditionalUserInfo\(credential\)\?\.isNewUser === true\)/);
});

test('extension install prompts are limited to devices that can install extensions', () => {
  const desktop = {
    chrome: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
    mac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
    edge: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36 Edg/142.0.0.0',
  };
  for (const [label, userAgent] of Object.entries(desktop)) assert.equal(canInstallExtension({ userAgent, maxTouchPoints: 0 }), true, label);
  const handheld = {
    androidPhone: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Mobile Safari/537.36',
    androidTablet: 'Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
    iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/142.0 Mobile/15E148 Safari/604.1',
  };
  for (const [label, userAgent] of Object.entries(handheld)) assert.equal(canInstallExtension({ userAgent, maxTouchPoints: 5 }), false, label);
  assert.equal(canInstallExtension({ userAgent: desktop.mac, maxTouchPoints: 5 }), false, 'iPad asking for the desktop site');
  assert.equal(canInstallExtension({ userAgent: desktop.chrome, userAgentData: { mobile: true } }), false, 'client hints say mobile');
});

test('the site-wide extension bar only shows where the extension can be installed', () => {
  const bar = source('src/components/extension-announcement.tsx');
  assert.match(bar, /setInstallable\(canInstallExtension\(\)\)/);
  assert.match(bar, /const visible = installable && /);
});
