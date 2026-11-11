'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { FPX, fakeChrome, senderFor } = require('./helpers/load');

const FP = FPX.config.FP_ORIGIN;
const TOKEN = '11111111-2222-4333-8444-555555555555';
const xp = (id = 7, url = 'https://www.xplace.com/il/u/dana-design') => senderFor(url, id);
const fp = (path, query = '', id = 50) => senderFor(`${FP}${path}${query}`, id, { tab: { id, windowId: 2 } });
const payload = (extra = {}) => ({ kind: 'profile', url: 'https://www.xplace.com/il/u/dana-design', headline: 'h', ...extra });

function make(opts) {
  const f = fakeChrome(opts);
  let t = 1_000_000; let n = 0;
  const bg = FPX.background.create({ chrome: f.chrome, now: () => t, randomUUID: () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}` });
  return { ...f, bg, advance: (ms) => { t += ms; } };
}

test('stage stores under a random token, opens the hand-off URL, closes nothing by default', async () => {
  const m = make();
  const r = await m.bg.handle({ type: 'stage', payload: payload() }, xp());
  assert.equal(r.ok, true);
  assert.equal(m.calls.created[0].url, `${FP}/profile/import?xplace=00000000-0000-4000-8000-000000000001`);
  assert.deepEqual(m.calls.removed, []);
  const stored = [...m.mem.keys()];
  assert.deepEqual(stored, ['stage:00000000-0000-4000-8000-000000000001']);
  const proj = await m.bg.handle({ type: 'stage', payload: { kind: 'project', projectId: '123456' } }, xp());
  assert.match(m.calls.created[1].url, /\/projects\/new\?xplace=/);
  assert.equal(proj.ok, true);
});

test('stage rejects wrong senders, wrong kinds and oversized payloads', async () => {
  const m = make();
  assert.equal((await m.bg.handle({ type: 'stage', payload: payload() }, fp('/profile/import'))).error, 'unauthorized');
  assert.equal((await m.bg.handle({ type: 'stage', payload: payload() }, senderFor('https://evil.com/', 1))).error, 'unauthorized');
  assert.equal((await m.bg.handle({ type: 'stage', payload: payload() }, senderFor('http://www.xplace.com/', 1))).error, 'unauthorized');
  assert.equal((await m.bg.handle({ type: 'stage', payload: payload() }, senderFor('https://www.xplace.com/', 1, { id: 'other-ext' }))).error, 'unauthorized');
  assert.equal((await m.bg.handle({ type: 'stage', payload: payload() }, { id: 'ext', url: 'https://www.xplace.com/', frameId: 0 })).error, 'unauthorized');
  for (const bad of [null, [], 'x', { kind: 'other' }]) assert.equal((await m.bg.handle({ type: 'stage', payload: bad }, xp())).error, 'invalid-payload');
  const big = payload({ pad: 'x'.repeat(FPX.config.MAX_PAYLOAD_BYTES) });
  assert.equal((await m.bg.handle({ type: 'stage', payload: big }, xp())).error, 'too-large');
  assert.equal(m.calls.created.length, 0);
  assert.equal(m.mem.size, 0);
});

test('read and clear: authorised only from the hand-off path of FP_ORIGIN with the matching token', async () => {
  const m = make();
  await m.bg.handle({ type: 'stage', payload: payload() }, xp());
  const token = '00000000-0000-4000-8000-000000000001';
  const ok = fp('/profile/import', `?xplace=${token}`);
  const r = await m.bg.handle({ type: 'read', token }, ok);
  assert.equal(r.ok, true); assert.equal(r.payload.headline, 'h');
  assert.equal((await m.bg.handle({ type: 'read', token }, ok)).ok, true, 'read keeps the payload');
  assert.equal((await m.bg.handle({ type: 'read', token }, fp('/projects/new', `?xplace=${token}`))).ok, true);
  // rejected
  assert.equal((await m.bg.handle({ type: 'read', token }, fp('/profile/other', `?xplace=${token}`))).error, 'unauthorized', 'wrong path');
  assert.equal((await m.bg.handle({ type: 'read', token }, senderFor(`https://evil.com/profile/import?xplace=${token}`, 1))).error, 'unauthorized', 'wrong origin');
  assert.equal((await m.bg.handle({ type: 'read', token }, xp(7, `https://www.xplace.com/profile/import?xplace=${token}`))).error, 'unauthorized', 'xplace sender');
  assert.equal((await m.bg.handle({ type: 'read', token }, fp('/profile/import', `?xplace=${TOKEN}`))).error, 'unauthorized', 'token mismatch');
  assert.equal((await m.bg.handle({ type: 'read', token }, fp('/profile/import'))).error, 'unauthorized', 'no token in URL');
  assert.equal((await m.bg.handle({ type: 'clear', token }, fp('/profile/import', `?xplace=${TOKEN}`))).error, 'unauthorized');
  assert.equal(m.mem.size, 1);
  assert.equal((await m.bg.handle({ type: 'clear', token }, ok)).ok, true);
  assert.equal((await m.bg.handle({ type: 'read', token }, ok)).error, 'not-found');
});

test('staged payloads expire after one hour and are purged', async () => {
  const m = make();
  await m.bg.handle({ type: 'stage', payload: payload() }, xp());
  const token = '00000000-0000-4000-8000-000000000001';
  m.advance(59 * 60 * 1000);
  assert.equal((await m.bg.handle({ type: 'read', token }, fp('/profile/import', `?xplace=${token}`))).ok, true);
  m.advance(2 * 60 * 1000);
  assert.equal((await m.bg.handle({ type: 'read', token }, fp('/profile/import', `?xplace=${token}`))).error, 'not-found');
  assert.equal(m.mem.size, 0, 'purged');
});

test('at most MAX_STAGED_ENTRIES are kept (oldest evicted)', async () => {
  const m = make();
  for (let i = 0; i < 8; i += 1) { await m.bg.handle({ type: 'stage', payload: payload() }, xp()); m.advance(10); }
  assert.ok([...m.mem.keys()].filter((k) => k.startsWith('stage:')).length <= FPX.config.MAX_STAGED_ENTRIES + 1);
});

test('helper tab: opened for a valid slug only, authorises auto-capture, closed after staging', async () => {
  const m = make();
  assert.equal((await m.bg.handle({ type: 'open-helper', slug: '../evil' }, xp())).error, 'invalid-slug');
  assert.equal((await m.bg.handle({ type: 'open-helper', slug: 'dana-design' }, fp('/profile/import'))).error, 'unauthorized');
  assert.equal((await m.bg.handle({ type: 'open-helper', slug: 'dana-design' }, xp())).ok, true);
  assert.deepEqual(m.calls.created[0], { url: 'https://www.xplace.com/il/u/dana-design?fp_import=1', active: true });
  const helperTab = 100;
  assert.equal((await m.bg.handle({ type: 'auto-check' }, xp(999))).allowed, false, 'a random tab is not authorised');
  assert.equal((await m.bg.handle({ type: 'auto-check' }, xp(helperTab))).allowed, true);
  // closeSender from an unrelated tab closes nothing
  const other = await m.bg.handle({ type: 'stage', payload: payload(), closeSender: true }, xp(999));
  assert.equal(other.closed, false); assert.ok(!m.calls.removed.includes(999));
  const done = await m.bg.handle({ type: 'stage', payload: payload(), closeSender: true }, xp(helperTab));
  assert.equal(done.closed, true); assert.deepEqual(m.calls.removed, [helperTab]);
  assert.equal((await m.bg.handle({ type: 'auto-check' }, xp(helperTab))).allowed, false, 'used once');
});

test('helper tab authorisation expires', async () => {
  const m = make();
  await m.bg.handle({ type: 'open-helper', slug: 'dana-design' }, xp());
  m.advance(FPX.config.HELPER_TAB_TTL_MS + 1);
  assert.equal((await m.bg.handle({ type: 'auto-check' }, xp(100))).allowed, false);
});

test('open-fp only opens the fixed projects/new URL', async () => {
  const m = make();
  assert.equal((await m.bg.handle({ type: 'open-fp', target: 'https://evil.com' }, xp())).error, 'invalid-target');
  assert.equal((await m.bg.handle({ type: 'open-fp', target: 'projects-new' }, xp())).ok, true);
  assert.equal(m.calls.created[0].url, `${FP}/projects/new`);
});

// ---------- await / staged / focus / fallback ----------
const bridgeReply = (ok) => (msg, sender, respond) => { if (ok === undefined) return; respond({ ok }); };

test('await: only the bridge on the Freelance Place origin, valid token; first registration wins', async () => {
  const m = make();
  assert.equal((await m.bg.handle({ type: 'await', token: TOKEN }, xp())).error, 'unauthorized');
  assert.equal((await m.bg.handle({ type: 'await', token: 'nope' }, fp('/profile/import'))).error, 'invalid-token');
  assert.equal((await m.bg.handle({ type: 'await', token: TOKEN }, fp('/profile/import'))).ok, true);
  assert.deepEqual(m.mem.get(`await:${TOKEN}`), { tabId: 50, windowId: 2, expires: 1_000_000 + 15 * 60 * 1000, captureGranted: false });
  assert.equal((await m.bg.handle({ type: 'await', token: TOKEN }, fp('/profile/import', '', 51))).error, 'token-in-use');
  assert.equal(m.mem.get(`await:${TOKEN}`).tabId, 50);
  assert.equal((await m.bg.handle({ type: 'await', token: TOKEN }, fp('/profile/import', '', 50))).ok, true, 'same tab may refresh');
  m.advance(16 * 60 * 1000);
  assert.equal((await m.bg.handle({ type: 'await', token: TOKEN }, fp('/profile/import', '', 51))).ok, true, 'free again after expiry');
});

test('stage with a live await entry: delivery confirmed by the bridge -> focus, close helper, no new tab', async () => {
  const m = make();
  m.listenOnTab(50, bridgeReply(true));
  await m.bg.handle({ type: 'await', token: TOKEN }, fp('/profile/import'));
  assert.equal((await m.bg.handle({ type: 'auto-check', ref: TOKEN }, xp(8))).allowed, true);
  const r = await m.bg.handle({ type: 'stage', payload: payload(), ref: TOKEN, closeSender: true }, xp(8));
  assert.equal(r.ok, true); assert.equal(r.closed, true);
  assert.ok(m.mem.has(`stage:${TOKEN}`));
  assert.deepEqual(m.calls.sent, [[50, { type: 'staged', token: TOKEN }]]);
  assert.deepEqual(m.calls.updated, [[50, { active: true }]]);
  assert.deepEqual(m.calls.windows, [[2, { focused: true }]]);
  assert.deepEqual(m.calls.created, []);
  assert.deepEqual(m.calls.removed, [8]);
});

test('L4: awaited tokens are readable and clearable only by the registered tab, never by URL', async () => {
  const m = make();
  m.listenOnTab(50, bridgeReply(true));
  await m.bg.handle({ type: 'await', token: TOKEN }, fp('/profile/import'));
  await m.bg.handle({ type: 'stage', payload: payload(), ref: TOKEN }, xp(8));
  assert.equal((await m.bg.handle({ type: 'read', token: TOKEN }, fp('/profile/import', '', 50))).ok, true);
  // another tab that knows the (XPlace-visible) token cannot read it, even with the token in its URL
  assert.equal((await m.bg.handle({ type: 'read', token: TOKEN }, fp('/profile/import', `?xplace=${TOKEN}`, 51))).error, 'unauthorized');
  assert.equal((await m.bg.handle({ type: 'clear', token: TOKEN }, fp('/profile/import', `?xplace=${TOKEN}`, 51))).error, 'unauthorized');
  // and still not once the await entry is gone
  await m.bg.handle({ type: 'clear', token: TOKEN }, fp('/profile/import', '', 50));
  m.mem.set(`stage:${TOKEN}`, { payload: payload(), expires: 9e9, ownerTabId: 50 });
  assert.equal((await m.bg.handle({ type: 'read', token: TOKEN }, fp('/profile/import', `?xplace=${TOKEN}`, 51))).error, 'unauthorized');
  assert.equal((await m.bg.handle({ type: 'clear', token: TOKEN }, fp('/profile/import', '', 50))).ok, true);
  assert.equal(m.mem.has(`stage:${TOKEN}`), false);
});

test('M1: a bridge that does not confirm (or no listener, or an unconfirmed reply) means fallback, no focus', async () => {
  for (const setup of [(m) => m.listenOnTab(50, bridgeReply(undefined)), (m) => m.listenOnTab(50, bridgeReply(false)), () => {}]) {
    const m = make();
    setup(m);
    await m.bg.handle({ type: 'await', token: TOKEN }, fp('/profile/import'));
    const r = await m.bg.handle({ type: 'stage', payload: payload(), ref: TOKEN }, xp(8));
    assert.equal(r.ok, true);
    assert.deepEqual(m.calls.updated, [], 'old tab is not focused');
    assert.deepEqual(m.calls.windows, []);
    const url = new URL(m.calls.created[0].url);
    assert.equal(url.pathname, '/profile/import');
    const fresh = url.searchParams.get('xplace');
    assert.notEqual(fresh, TOKEN, 'fresh token, not the XPlace-visible ref');
    assert.ok(m.mem.has(`stage:${fresh}`)); assert.ok(!m.mem.has(`stage:${TOKEN}`));
    // the new tab reads it through the URL rule
    assert.equal((await m.bg.handle({ type: 'read', token: fresh }, fp('/profile/import', `?xplace=${fresh}`, 60))).ok, true);
  }
});

test('M2: auto-check for a ref is single use; the await entry stays for read/clear and staged', async () => {
  const m = make();
  m.listenOnTab(50, bridgeReply(true));
  await m.bg.handle({ type: 'await', token: TOKEN }, fp('/profile/import'));
  assert.equal((await m.bg.handle({ type: 'auto-check', ref: TOKEN }, xp(8))).allowed, true);
  assert.equal((await m.bg.handle({ type: 'auto-check', ref: TOKEN }, xp(8))).allowed, false, 'replay (reload, Back, restored tab)');
  assert.equal((await m.bg.handle({ type: 'auto-check', ref: TOKEN }, xp(9))).allowed, false, 'other tab');
  assert.equal(m.mem.get(`await:${TOKEN}`).captureGranted, true);
  const r = await m.bg.handle({ type: 'stage', payload: payload(), ref: TOKEN, closeSender: true }, xp(8));
  assert.equal(r.closed, true, 'staged still delivered after the single grant');
  assert.equal((await m.bg.handle({ type: 'read', token: TOKEN }, fp('/profile/import', '', 50))).ok, true);
  assert.equal((await m.bg.handle({ type: 'auto-check', ref: '99999999-2222-4333-8444-555555555555' }, xp(8))).allowed, false, 'unknown ref');
});

test('M2: the helper tab opened by the extension is single use too', async () => {
  const m = make();
  await m.bg.handle({ type: 'open-helper', slug: 'dana-design' }, xp());
  assert.equal((await m.bg.handle({ type: 'auto-check' }, xp(100))).allowed, true);
  assert.equal((await m.bg.handle({ type: 'auto-check' }, xp(100))).allowed, false);
  const done = await m.bg.handle({ type: 'stage', payload: payload(), closeSender: true }, xp(100));
  assert.equal(done.closed, true, 'still closable after the grant was used');
});

test('sub-frame senders are refused', async () => {
  const m = make();
  assert.equal((await m.bg.handle({ type: 'stage', payload: payload() }, senderFor('https://www.xplace.com/il/u/a', 7, { frameId: 3 }))).error, 'unauthorized');
  await m.bg.handle({ type: 'await', token: TOKEN }, fp('/profile/import'));
  assert.equal((await m.bg.handle({ type: 'await', token: '99999999-2222-4333-8444-555555555555' }, senderFor(`${FP}/profile/import`, 50, { frameId: 2 }))).error, 'unauthorized');
});

test('stage with a ref that nobody awaits gets a fresh token; expired await entries are ignored and purged', async () => {
  const m = make();
  const r = await m.bg.handle({ type: 'stage', payload: payload(), ref: TOKEN }, xp(8));
  assert.equal(r.ok, true);
  assert.ok(!m.mem.has(`stage:${TOKEN}`));
  await m.bg.handle({ type: 'await', token: TOKEN }, fp('/profile/import'));
  m.advance(16 * 60 * 1000);
  await m.bg.handle({ type: 'stage', payload: payload(), ref: TOKEN }, xp(8));
  assert.ok(!m.mem.has(`await:${TOKEN}`), 'expired await purged');
  assert.ok(!m.mem.has(`stage:${TOKEN}`));
});

test('await is accepted from any main-frame page of the Freelance Place origin, nowhere else', async () => {
  const m = make();
  assert.equal((await m.bg.handle({ type: 'await', token: TOKEN }, fp('/'))).ok, true);
  const T2 = '99999999-2222-4333-8444-555555555555';
  assert.equal((await m.bg.handle({ type: 'await', token: T2 }, fp('/anything/else', '?x=1', 51))).ok, true);
  assert.equal((await m.bg.handle({ type: 'await', token: '33333333-2222-4333-8444-555555555555' }, senderFor('https://evil.example/', 52))).error, 'unauthorized');
  assert.equal((await m.bg.handle({ type: 'await', token: '33333333-2222-4333-8444-555555555555' }, senderFor(`${FP}/`, 53, { frameId: 4 }))).error, 'unauthorized');
  assert.equal((await m.bg.handle({ type: 'await', token: '33333333-2222-4333-8444-555555555555' }, xp())).error, 'unauthorized');
});

test('awaited tokens: read/clear from `/` only for the registered tab; the URL-token rule needs a hand-off path', async () => {
  const m = make();
  m.listenOnTab(50, bridgeReply(true));
  await m.bg.handle({ type: 'await', token: TOKEN }, fp('/'));
  await m.bg.handle({ type: 'stage', payload: payload(), ref: TOKEN }, xp(8));
  assert.equal((await m.bg.handle({ type: 'read', token: TOKEN }, fp('/', '', 50))).ok, true);
  assert.equal((await m.bg.handle({ type: 'read', token: TOKEN }, fp('/', '', 51))).error, 'unauthorized');
  // fallback flow: a fresh token only works from a hand-off path with the token in the URL
  const fresh = 'aaaaaaaa-2222-4333-8444-555555555555';
  m.mem.set(`stage:${fresh}`, { payload: payload(), expires: 9e9 });
  assert.equal((await m.bg.handle({ type: 'read', token: fresh }, fp('/', `?xplace=${fresh}`, 60))).error, 'unauthorized', 'not a hand-off path');
  assert.equal((await m.bg.handle({ type: 'read', token: fresh }, fp('/profile/import', `?xplace=${fresh}`, 60))).ok, true);
  assert.equal((await m.bg.handle({ type: 'read', token: fresh }, fp('/projects/new', `?xplace=${fresh}`, 61))).ok, true);
});

test('unknown message types are refused', async () => {
  const m = make();
  assert.equal((await m.bg.handle({ type: 'constructor' }, xp())).error, 'unknown');
  assert.equal((await m.bg.handle(null, xp())).error, 'unknown');
});
