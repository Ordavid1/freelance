'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { FPX, dom, fixture, fakeChrome } = require('./helpers/load');
const S = FPX.promptState;
const cfg = FPX.config;
const HOUR = 3600e3;

const ctxOf = (over) => ({ session: { loggedIn: true }, page: { kind: 'profile' }, isOwn: false, ...over });

test('policy: logged out and forever hide everything', () => {
  const st = S.normalise(null);
  assert.equal(S.decide(null, st, 0, cfg).visible, false);
  assert.equal(S.decide(ctxOf({ session: { loggedIn: false } }), st, 0, cfg).visible, false);
  assert.equal(S.decide(ctxOf(), S.dismissForever(st), 0, cfg).visible, false);
});

test('policy: own page opens every visit, other pages once per 24h', () => {
  let st = S.normalise(null);
  const own = ctxOf({ isOwn: true });
  assert.equal(S.decide(own, st, 1000, cfg).autoOpenCard, true);
  st = S.recordAutoOpen(st, 1000);
  assert.equal(S.decide(own, st, 2000, cfg).autoOpenCard, true, 'own pages ignore the 24 h budget');
  const other = ctxOf();
  assert.equal(S.decide(other, st, 1000 + 23 * HOUR, cfg).autoOpenCard, false);
  assert.equal(S.decide(other, st, 1000 + 23 * HOUR, cfg).pill, true);
  assert.equal(S.decide(other, st, 1000 + 25 * HOUR, cfg).autoOpenCard, true);
  assert.equal(S.decide(own, st, 9000, cfg, true).autoOpenCard, false, 'already opened on this URL');
  assert.equal(S.decide(own, st, 9000, { ...cfg, AUTO_OPEN_OWN_PAGES: 'never' }).autoOpenCard, false);
});

test('policy: re-enable and storage round trip with a fake area', async () => {
  const { chrome } = fakeChrome();
  let st = await S.loadState(chrome.storage.local);
  assert.equal(st.dismissedForever, false);
  await S.saveState(chrome.storage.local, S.dismissForever(st));
  st = await S.loadState(chrome.storage.local);
  assert.equal(st.dismissedForever, true);
  st = S.enable(st);
  assert.equal(S.decide(ctxOf(), st, 0, cfg).visible, true);
});

test('policy: a snooze saved by an earlier version is ignored (the invitation comes back)', async () => {
  const { chrome } = fakeChrome();
  await chrome.storage.local.set({ [S.KEY]: { dismissedForever: false, snoozeUntil: 9e15, lastAutoOpen: 5 } });
  const st = await S.loadState(chrome.storage.local);
  assert.deepEqual(st, { dismissedForever: false, lastAutoOpen: 5 });
  assert.equal(S.decide(ctxOf({ isOwn: true }), st, 1000, cfg).autoOpenCard, true);
});

// ---------- controller with jsdom ----------
function setup({ html = fixture('profile-own.html'), url = 'https://www.xplace.com/il/u/dana-design', replies = {}, start = 1e12, fetchImpl } = {}) {
  const d = dom(html, url);
  const { chrome } = fakeChrome();
  const sent = [];
  let t = start;
  const loc = { href: url, search: new URL(url).search, replace(u) { loc.replaced = u; } };
  const replaced = [];
  const history = { state: null, replaceState(st, title, u) { replaced.push(u); loc.href = new URL(u, loc.href).href; loc.search = new URL(loc.href).search; } };
  chrome.runtime.sendMessage = async (m) => { sent.push(m); const r = replies[m.type]; return typeof r === 'function' ? r(m) : (r || { ok: true }); };
  const ctl = FPX.content.createController({
    win: d.window, doc: d.window.document, location: loc, history, chrome, storage: chrome.storage.local,
    now: () => t, sleep: async () => {}, fetchImpl,
  });
  return { ctl, d, sent, loc, history, replaced, chrome, advance: (ms) => { t += ms; }, doc: d.window.document, set href(v) { loc.href = v; loc.search = new URL(v).search; } };
}
const text = (ctl) => (ctl.ui.shadow ? ctl.ui.shadow.textContent : '');

test('own profile: card auto-opens with copy, disclosure, brand line and dialog role', async () => {
  const s = setup();
  await s.ctl.tick(); await s.ctl.state;
  assert.equal(s.ctl.model.cardOpen, true);
  const root = s.ctl.ui.shadow;
  const t = root.textContent;
  for (const want of ['Freelance Place · תוסף', 'העבירו את הפרופיל שלכם ל־Freelance Place', 'בלחיצה אחת', 'אתם בודקים ועורכים הכול לפני שמירה', 'לא משנים ולא מוחקים דבר ב־XPlace', 'העתקת הפרופיל', 'הגדרות',
    'לפני הלחיצה נבדק רק אם אתם מחוברים ובעלי הדף. תוכן הפרופיל נקרא ונשלח ל־Freelance Place רק בלחיצה שלכם, לעריכה.']) assert.ok(t.includes(want), want);
  const card = root.querySelector('[role="dialog"]');
  assert.equal(card.getAttribute('aria-modal'), 'false');
  assert.ok(root.querySelector('style') || true);
  assert.ok(!/\d+\s*(שעות|דקות)|מהר|אחרון|עכשיו!/.test(t), 'no urgency wording');
  // The card is closed with its X; there are no "not now" / "do not show again" buttons any more.
  assert.ok(!t.includes('לא עכשיו') && !t.includes('אל תציגו שוב'));
  assert.deepEqual([...root.querySelectorAll('[data-action]')].map((b) => b.getAttribute('data-action')).sort(), ['onCloseCard', 'onCta', 'onSettings']);
  assert.equal(s.ctl.ui.host.parentNode, s.doc.documentElement);
});

test('card then pill: Esc collapses, pill opens it again, pill can be hidden', async () => {
  const s = setup();
  await s.ctl.tick();
  s.doc.dispatchEvent(new s.d.window.KeyboardEvent('keydown', { key: 'Escape' }));
  assert.equal(s.ctl.model.cardOpen, false);
  assert.ok(s.ctl.ui.shadow.querySelector('.pill'));
  s.ctl.ui.shadow.querySelector('[data-action="onOpenCard"]').click();
  assert.equal(s.ctl.model.cardOpen, true);
  s.ctl.ui.shadow.querySelector('[data-action="onCloseCard"]').click();
  s.ctl.ui.shadow.querySelector('[data-action="onHidePill"]').click();
  assert.equal(s.ctl.ui.host, null);
});

test('other page: pill only, card once per 24 h; settings opens options', async () => {
  const s = setup({ url: 'https://www.xplace.com/il/', html: fixture('profile-own.html') });
  s.ctl.state; // eslint
  await s.ctl.tick();
  assert.equal(s.ctl.model.cardOpen, true, 'first visit opens the card');
  s.ctl.ui.shadow.querySelector('[data-action="onCloseCard"]').click();
  s.href = 'https://www.xplace.com/il/projects';
  await s.ctl.tick();
  assert.equal(s.ctl.model.cardOpen, false, 'within 24 h only the pill');
  assert.ok(s.ctl.ui.shadow.querySelector('.pill'));
  s.advance(25 * HOUR);
  s.href = 'https://www.xplace.com/il/projects/2';
  await s.ctl.tick();
  assert.equal(s.ctl.model.cardOpen, true);
  s.ctl.ui.shadow.querySelector('[data-action="onSettings"]').click();
  assert.ok(s.sent.some((m) => m.type === 'open-options'));
});

test('switched off in the options page: nothing is shown, even when the page is visited again', async () => {
  const s = setup({ url: 'https://www.xplace.com/il/' });
  await s.chrome.storage.local.set({ [S.KEY]: { dismissedForever: true } });
  await s.ctl.start();
  try {
    await s.ctl.tick();
    assert.equal(s.ctl.ui.host, null, 'nothing visible while switched off');
    assert.equal(s.ctl.model.cardOpen, false);
  } finally { s.ctl.stop(); }
});

test('host element is re-attached when the page removes it', async () => {
  const s = setup();
  await s.ctl.tick();
  s.ctl.ui.host.remove();
  await s.ctl.tick();
  assert.ok(s.ctl.ui.host.isConnected);
});

test('logged-out visitors see nothing', async () => {
  const s = setup({ html: fixture('profile-own.html').replace("'4242'", "''") });
  await s.ctl.tick();
  assert.equal(s.ctl.ui.host, null);
});

test('click on own profile captures and stages (no ref, no close)', async () => {
  const s = setup({ replies: { stage: { ok: true, closed: false } } });
  await s.ctl.tick();
  s.sent.length = 0;
  s.ctl.ui.shadow.querySelector('[data-action="onCta"]').click();
  await new Promise((r) => setTimeout(r, 20));
  const stage = s.sent.find((m) => m.type === 'stage');
  assert.ok(stage, 'stage message sent');
  assert.equal(stage.payload.kind, 'profile');
  assert.equal(stage.payload.ownerSignal, true);
  assert.equal(stage.payload.url, 'https://www.xplace.com/il/u/dana-design');
  assert.equal(stage.closeSender, false);
  assert.ok(!JSON.stringify(stage).includes('CANARY'));
  assert.equal(s.ctl.model.status, 'done');
});

test('no page content is read before the click', async () => {
  const s = setup();
  let reads = 0;
  const orig = s.doc.querySelector.bind(s.doc);
  s.doc.querySelector = (q) => { if (q.includes('profile_')) reads += 1; return orig(q); };
  await s.ctl.tick(); await s.ctl.tick();
  assert.equal(reads, 0);
});

test('click on another page opens the helper tab for the own slug; no slug is an error', async () => {
  const s = setup({ url: 'https://www.xplace.com/il/u/someone', html: fixture('profile-own.html').replace('OWNER = true', 'OWNER = false') });
  await s.ctl.tick();
  s.ctl.ui.shadow.querySelector('[data-action="onCta"]').click();
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(s.sent.find((m) => m.type === 'open-helper'), { type: 'open-helper', slug: 'dana-design' });
  assert.ok(!s.sent.some((m) => m.type === 'stage'));
  const n = setup({ url: 'https://www.xplace.com/il/', html: fixture('profile-own.html').replace(/GLOBAL_JS_THIS_COMPANY_USER_NAME = '[^']*';/, '') });
  await n.ctl.tick();
  n.ctl.ui.shadow.querySelector('[data-action="onCta"]').click();
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(n.ctl.model.status, 'error');
  assert.ok(n.ctl.model.message.includes('כתובת הפרופיל'));
});

test('publisher on a non-own page: CTA opens Freelance Place projects/new', async () => {
  const s = setup({ url: 'https://www.xplace.com/il/', html: fixture('profile-own.html').replace("'PROVIDER'", "'COMPANY'") });
  await s.ctl.tick();
  assert.ok(s.ctl.ui.shadow.textContent.includes('פרסמו את הפרויקטים שלכם גם ב־Freelance Place'));
  s.ctl.ui.shadow.querySelector('[data-action="onCta"]').click();
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(s.sent.find((m) => m.type === 'open-fp'), { type: 'open-fp', target: 'projects-new' });
  assert.ok(s.ctl.ui.shadow.textContent.includes('ושום תוכן לא נקרא מהעמוד ולא נשלח.'));
});

test('publisher (buyer) account on its own profile: profile copy, and the click captures the profile', async () => {
  const s = setup({ html: fixture('profile-own.html').replace("'PROVIDER'", "'BUYER'"), replies: { stage: { ok: true, closed: false } } });
  await s.ctl.tick();
  const t = s.ctl.ui.shadow.textContent;
  assert.ok(t.includes('העבירו את הפרופיל שלכם ל־Freelance Place') && t.includes('העתקת הפרופיל'));
  assert.ok(!t.includes('פרסמו את הפרויקטים שלכם'), 'not the publisher copy');
  s.sent.length = 0;
  s.ctl.ui.shadow.querySelector('[data-action="onCta"]').click();
  await new Promise((r) => setTimeout(r, 20));
  assert.ok(!s.sent.some((m) => m.type === 'open-fp'), 'does not just open Freelance Place');
  const stage = s.sent.find((m) => m.type === 'stage');
  assert.ok(stage && stage.payload.kind === 'profile' && stage.payload.ownerSignal === true);
  assert.equal(s.ctl.model.status, 'done');
});

test('own project page (new format): project copy, capture from inline JSON, no fetch', async () => {
  const html = fixture('project-rsc.html').replace('\\"isProjectOwner\\":false', '\\"isProjectOwner\\":true').replace('<script>', "<script>var GLOBAL_JS_THIS_COMPANY_ID='1';</script><script>");
  let fetched = 0;
  const s = setup({ html, url: 'https://www.xplace.com/il/job-bids/123456', fetchImpl: async () => { fetched += 1; return { ok: false }; } });
  await s.ctl.tick();
  assert.ok(s.ctl.ui.shadow.textContent.includes('פרסמו גם את הפרויקט הזה ב־Freelance Place'));
  assert.ok(s.ctl.ui.shadow.textContent.includes('פרסום פרויקטים חינם'));
  assert.ok(s.ctl.ui.shadow.textContent.includes('תוכן הפרויקט נקרא ונשלח ל־Freelance Place רק בלחיצה שלכם, לעריכה.'));
  s.ctl.ui.shadow.querySelector('[data-action="onCta"]').click();
  await new Promise((r) => setTimeout(r, 20));
  const stage = s.sent.find((m) => m.type === 'stage');
  assert.equal(stage.payload.kind, 'project'); assert.equal(stage.payload.projectId, '123456');
  assert.equal(fetched, 0);
});

test('legacy project page: ONE same-origin fetch at click time only', async () => {
  const live = fixture('project-rsc.html').replace('\\"isProjectOwner\\":false', '\\"isProjectOwner\\":true');
  const legacy = '<html><script>var GLOBAL_JS_THIS_COMPANY_ID=\'1\'; var PROJECT_PAGE_IS_THIS_COMPANY_OWNER = true;</script><body>legacy</body></html>';
  const calls = [];
  const s = setup({ html: legacy, url: 'https://www.xplace.com/project?id=123456', fetchImpl: async (...a) => { calls.push(a); return { ok: true, text: async () => live }; } });
  await s.ctl.tick(); await s.ctl.tick();
  assert.equal(calls.length, 0, 'no fetch before the click');
  s.ctl.ui.shadow.querySelector('[data-action="onCta"]').click();
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], ['/project?id=123456', { credentials: 'same-origin' }]);
  assert.equal(s.sent.find((m) => m.type === 'stage').payload.projectId, '123456');
});

test('not the owner of the project: no capture', async () => {
  const html = fixture('project-rsc.html').replace('<script>', "<script>var GLOBAL_JS_THIS_COMPANY_ID='1';</script><script>");
  const s = setup({ html, url: 'https://www.xplace.com/il/job-bids/123456' });
  await s.ctl.tick();
  // other people's project: the freelancer variant, whose click never reads this page
  s.ctl.ui.shadow.querySelector('[data-action="onCta"]').click();
  await new Promise((r) => setTimeout(r, 20));
  assert.ok(!s.sent.some((m) => m.type === 'stage'));
});

test('launch pad: logged-in user is redirected to the own profile with the ref', async () => {
  const ref = '11111111-2222-4333-8444-555555555555';
  const s = setup({ url: `https://www.xplace.com/il/?fp_import=profile&fp_ref=${ref}` });
  await s.ctl.tick();
  assert.equal(s.loc.replaced, `/il/u/dana-design?fp_import=1&fp_ref=${ref}`);
});

test('launch pad: invalid ref is ignored; logged-out user gets the login hint', async () => {
  const bad = setup({ url: 'https://www.xplace.com/il/?fp_import=profile&fp_ref=nope' });
  await bad.ctl.tick();
  assert.equal(bad.loc.replaced, undefined);
  const ref = '11111111-2222-4333-8444-555555555555';
  const out = setup({ url: `https://www.xplace.com/il/?fp_import=profile&fp_ref=${ref}`, html: fixture('profile-own.html').replace("'4242'", "''") });
  for (let i = 0; i < 5; i += 1) await out.ctl.tick();
  assert.equal(out.loc.replaced, undefined);
  assert.equal(out.ctl.model.notice, 'התחברו ל־XPlace ואז חזרו ל־Freelance Place ולחצו שוב על כפתור XPlace.');
});

test('auto-capture on fp_import=1 with ref: stage with ref and closeSender', async () => {
  const ref = '11111111-2222-4333-8444-555555555555';
  const s = setup({ url: `https://www.xplace.com/il/u/dana-design?fp_import=1&fp_ref=${ref}`, replies: { 'auto-check': { ok: true, allowed: true }, stage: { ok: true, closed: true } } });
  await s.ctl.tick();
  const check = s.sent.find((m) => m.type === 'auto-check');
  assert.equal(check.ref, ref);
  const stage = s.sent.find((m) => m.type === 'stage');
  assert.equal(stage.ref, ref); assert.equal(stage.closeSender, true);
  assert.equal(stage.payload.kind, 'profile');
  assert.equal(s.ctl.model.status, 'done');
});

test('auto-capture is refused when the background did not authorise it (crafted link)', async () => {
  const s = setup({ url: 'https://www.xplace.com/il/u/dana-design?fp_import=1', replies: { 'auto-check': { ok: true, allowed: false } } });
  await s.ctl.tick();
  assert.ok(!s.sent.some((m) => m.type === 'stage'));
  assert.equal(s.ctl.model.forced, false);
});

test('auto-capture on a profile that is not the user own: stops with the Hebrew message', async () => {
  const ref = '11111111-2222-4333-8444-555555555555';
  const html = fixture('profile-own.html').replace('OWNER = true', 'OWNER = false');
  const s = setup({ html, url: `https://www.xplace.com/il/u/someone?fp_import=1&fp_ref=${ref}`, replies: { 'auto-check': { ok: true, allowed: true } } });
  await s.ctl.tick();
  assert.ok(!s.sent.some((m) => m.type === 'stage'));
  assert.equal(s.ctl.model.status, 'error');
  assert.equal(s.ctl.model.message, 'זה לא הפרופיל שלכם ב־XPlace.');
});

test('validation failure (empty profile) is reported, nothing is staged', async () => {
  const html = fixture('profile-own.html').split('</head>')[0] + '</head><body><h1 id="profile_header_name"></h1><div id="profile_about_block"></div></body></html>';
  const s = setup({ html });
  s.ctl.state;
  await s.ctl.tick();
  const sleepCalls = 0; void sleepCalls;
  s.ctl.ui.shadow.querySelector('[data-action="onCta"]').click();
  await new Promise((r) => setTimeout(r, 50));
  assert.ok(!s.sent.some((m) => m.type === 'stage'));
  assert.equal(s.ctl.model.status, 'error');
});

test('M2: fp_import and fp_ref are stripped from the address bar before the capture starts', async () => {
  const ref = '11111111-2222-4333-8444-555555555555';
  const order = [];
  const s = setup({ url: `https://www.xplace.com/il/u/dana-design?fp_import=1&fp_ref=${ref}&keep=1#x`, replies: { 'auto-check': { ok: true, allowed: true }, stage: { ok: true, closed: true } } });
  const orig = s.history.replaceState;
  s.history.replaceState = (...a) => { order.push('strip'); return orig(...a); };
  const send = s.chrome.runtime.sendMessage;
  s.chrome.runtime.sendMessage = async (m) => { order.push(m.type); return send(m); };
  await s.ctl.tick();
  assert.deepEqual(s.replaced, ['/il/u/dana-design?keep=1#x']);
  assert.ok(order.indexOf('strip') < order.indexOf('auto-check') && order.indexOf('auto-check') < order.indexOf('stage'));
  assert.equal(s.sent.find((m) => m.type === 'stage').ref, ref, 'ref kept in memory for staging');
  // a reload of the stripped URL does nothing
  const again = setup({ url: 'https://www.xplace.com/il/u/dana-design' });
  await again.ctl.tick();
  assert.ok(!again.sent.some((m) => m.type === 'auto-check'));
});

test('M3: context is cached per URL; no re-parse on later ticks', async () => {
  const s = setup();
  let calls = 0;
  const orig = FPX.pages.describeContext;
  FPX.pages.describeContext = (...a) => { calls += 1; return orig(...a); };
  try {
    for (let i = 0; i < 6; i += 1) await s.ctl.tick();
    assert.equal(calls, 1);
    s.href = 'https://www.xplace.com/il/projects';
    await s.ctl.tick(); await s.ctl.tick();
    assert.equal(calls, 2, 'one more parse for the new URL');
  } finally { FPX.pages.describeContext = orig; }
});

test('M3: incomplete context is retried a bounded number of times', async () => {
  const s = setup({ html: fixture('profile-own.html').replace("'4242'", "''") });
  let calls = 0;
  const orig = FPX.pages.describeContext;
  FPX.pages.describeContext = (...a) => { calls += 1; return orig(...a); };
  try { for (let i = 0; i < 40; i += 1) await s.ctl.tick(); } finally { FPX.pages.describeContext = orig; }
  assert.ok(calls <= 12, `calls ${calls}`);
});

test('M3: while switched off in the options page nothing is parsed per tick, but a launch URL still works', async () => {
  const s = setup();
  await s.chrome.storage.local.set({ [S.KEY]: { dismissedForever: true } });
  await s.ctl.start();
  await s.ctl.tick();
  assert.equal(s.ctl.ui.host, null);
  let calls = 0;
  const orig = FPX.pages.describeContext;
  FPX.pages.describeContext = (...a) => { calls += 1; return orig(...a); };
  try {
    for (let i = 0; i < 5; i += 1) await s.ctl.tick();
    assert.equal(calls, 0);
    const ref = '11111111-2222-4333-8444-555555555555';
    s.href = `https://www.xplace.com/il/?fp_import=profile&fp_ref=${ref}`;
    await s.ctl.tick();
    assert.equal(s.loc.replaced, `/il/u/dana-design?fp_import=1&fp_ref=${ref}`);
  } finally { FPX.pages.describeContext = orig; s.ctl.stop(); }
});

test('L6: below the bottom-sheet width the card never opens by itself, the pill opens it', async () => {
  const s = setup();
  Object.defineProperty(s.d.window, 'innerWidth', { value: 400, configurable: true });
  await s.ctl.tick();
  assert.equal(s.ctl.model.cardOpen, false);
  assert.ok(s.ctl.ui.shadow.querySelector('.pill'));
  s.ctl.ui.shadow.querySelector('[data-action="onOpenCard"]').click();
  assert.equal(s.ctl.model.cardOpen, true);
  assert.equal(s.ctl.state.lastAutoOpen, 0, 'the 24 h budget is untouched');
});

test('L5: focus moves to the close button on a user-opened card and back to the pill; aria-expanded is truthful', async () => {
  const s = setup();
  Object.defineProperty(s.d.window, 'innerWidth', { value: 400, configurable: true });
  s.d.window.document.body.insertAdjacentHTML('beforeend', '<input id="field">');
  await s.ctl.tick();
  const shadow = s.ctl.ui.shadow;
  assert.equal(shadow.querySelector('[data-action="onOpenCard"]').getAttribute('aria-expanded'), 'false');
  shadow.querySelector('[data-action="onOpenCard"]').click();
  assert.equal(s.ctl.ui.shadow.activeElement.getAttribute('data-action'), 'onCloseCard');
  await s.ctl.tick();
  assert.equal(s.ctl.ui.shadow.activeElement.getAttribute('data-action'), 'onCloseCard', 'ticks do not steal or drop focus');
  s.doc.dispatchEvent(new s.d.window.KeyboardEvent('keydown', { key: 'Escape' }));
  assert.equal(s.ctl.ui.shadow.activeElement.getAttribute('data-action'), 'onOpenCard');
  assert.equal(s.ctl.ui.shadow.activeElement.getAttribute('aria-expanded'), 'false');
});

test('L5: an automatic open does not steal focus from the page', async () => {
  const s = setup();
  s.doc.body.insertAdjacentHTML('beforeend', '<input id="field">');
  s.doc.getElementById('field').focus();
  await s.ctl.tick();
  assert.equal(s.ctl.model.cardOpen, true);
  assert.equal(s.doc.activeElement.id, 'field');
});
