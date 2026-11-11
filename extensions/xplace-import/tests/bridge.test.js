'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { FPX, JSDOM } = require('./helpers/load');

const TOKEN = '11111111-2222-4333-8444-555555555555';
const FP = FPX.config.FP_ORIGIN;

function setup(url, reply = {}) {
  const d = new JSDOM('<!doctype html><html><head></head><body></body></html>', { url });
  const win = d.window;
  const got = [];
  win.addEventListener('message', (e) => { if (e.data && e.data.channel && e.data.channel.startsWith('fp-xplace-') && !e.data.channel.endsWith('request') && !e.data.channel.endsWith('await')) got.push(e.data); });
  const sent = [];
  let onMsg;
  const chrome = { runtime: { async sendMessage(m) { sent.push(m); const r = reply[m.type]; return typeof r === 'function' ? r(m) : (r || { ok: true }); }, onMessage: { addListener(fn) { onMsg = fn; } } } };
  const api = FPX.bridge.start({ window: win, chrome, version: '9.9.9' });
  const post = (data, opts = {}) => {
    win.dispatchEvent(new win.MessageEvent('message', { data, origin: opts.origin ?? win.location.origin, source: opts.source === undefined ? win : opts.source }));
  };
  const tick = () => new Promise((r) => setTimeout(r, 15));
  return { win, got, sent, post, tick, api, deliver: (m, sender, respond) => onMsg(m, sender, respond) };
}

test('marker attribute and ready message', async () => {
  const s = setup(`${FP}/profile/import?xplace=${TOKEN}`);
  assert.equal(s.win.document.documentElement.getAttribute('data-fp-xplace-extension'), '9.9.9');
  await s.tick();
  assert.deepEqual(s.got.find((m) => m.channel === 'fp-xplace-ready'), { channel: 'fp-xplace-ready', version: '9.9.9' });
});

test('marker and ready message on the homepage (client-side navigation never reloads a hand-off path)', async () => {
  const s = setup(`${FP}/`);
  assert.equal(s.win.document.documentElement.getAttribute('data-fp-xplace-extension'), '9.9.9');
  await s.tick();
  assert.ok(s.got.some((m) => m.channel === 'fp-xplace-ready'));
});

test('does nothing on another origin', () => {
  const d = new JSDOM('<html></html>', { url: 'https://evil.example/profile/import' });
  assert.equal(FPX.bridge.start({ window: d.window, chrome: { runtime: {} }, version: '1' }), null);
  assert.equal(d.window.document.documentElement.hasAttribute('data-fp-xplace-extension'), false);
});

test('read returns the payload, clear deletes; only for the token in the page URL', async () => {
  const s = setup(`${FP}/profile/import?xplace=${TOKEN}`, { read: { ok: true, payload: { kind: 'profile' } }, clear: { ok: true } });
  s.post({ channel: 'fp-xplace-request', token: TOKEN, action: 'read' });
  await s.tick();
  assert.deepEqual(s.got.find((m) => m.channel === 'fp-xplace-response'), { channel: 'fp-xplace-response', token: TOKEN, payload: { kind: 'profile' } });
  s.post({ channel: 'fp-xplace-request', token: TOKEN, action: 'clear' });
  await s.tick();
  assert.deepEqual(s.sent.map((m) => m.type), ['read', 'clear']);
  // a different token is never answered nor forwarded
  const other = '99999999-2222-4333-8444-555555555555';
  s.post({ channel: 'fp-xplace-request', token: other, action: 'read' });
  s.post({ channel: 'fp-xplace-request', token: TOKEN, action: 'delete' });
  await s.tick();
  assert.equal(s.sent.length, 2);
});

test('background errors are relayed as `error`', async () => {
  const s = setup(`${FP}/projects/new?xplace=${TOKEN}`, { read: { ok: false, error: 'not-found' } });
  s.post({ channel: 'fp-xplace-request', token: TOKEN, action: 'read' });
  await s.tick();
  assert.deepEqual(s.got.find((m) => m.channel === 'fp-xplace-response'), { channel: 'fp-xplace-response', token: TOKEN, error: 'not-found' });
});

test('messages from another source or origin are ignored', async () => {
  const s = setup(`${FP}/profile/import?xplace=${TOKEN}`);
  const frame = new JSDOM('').window;
  s.post({ channel: 'fp-xplace-request', token: TOKEN, action: 'read' }, { source: frame });
  s.post({ channel: 'fp-xplace-request', token: TOKEN, action: 'read' }, { origin: 'https://evil.example' });
  s.post({ channel: 'fp-xplace-await', token: TOKEN }, { origin: 'https://evil.example' });
  s.post('garbage'); s.post(null);
  await s.tick();
  assert.equal(s.sent.length, 0);
});

test('await flow: forwards to the background, acknowledges, then relays staged; read works for the awaited token', async () => {
  const s = setup(`${FP}/`, { await: { ok: true }, read: { ok: true, payload: { kind: 'profile' } } });
  s.post({ channel: 'fp-xplace-await', token: TOKEN });
  await s.tick();
  assert.deepEqual(s.sent[0], { type: 'await', token: TOKEN });
  assert.deepEqual(s.got.find((m) => m.channel === 'fp-xplace-awaiting'), { channel: 'fp-xplace-awaiting', token: TOKEN });
  let r1; let r2;
  s.deliver({ type: 'staged', token: TOKEN }, null, (r) => { r1 = r; });
  s.deliver({ type: 'staged', token: '99999999-2222-4333-8444-555555555555' }, null, (r) => { r2 = r; });
  assert.deepEqual(r1, { ok: true });
  assert.deepEqual(r2, { ok: false });
  await s.tick();
  assert.equal(s.got.filter((m) => m.channel === 'fp-xplace-staged').length, 1);
  s.post({ channel: 'fp-xplace-request', token: TOKEN, action: 'read' });
  await s.tick();
  assert.equal(s.sent[1].type, 'read');
  // invalid token is not forwarded
  s.post({ channel: 'fp-xplace-await', token: 'x' });
  await s.tick();
  assert.equal(s.sent.length, 2);
});

test('await refused by the background gives no acknowledgement', async () => {
  const s = setup(`${FP}/profile/import`, { await: { ok: false, error: 'unauthorized' } });
  s.post({ channel: 'fp-xplace-await', token: TOKEN });
  await s.tick();
  assert.ok(!s.got.some((m) => m.channel === 'fp-xplace-awaiting'));
});
