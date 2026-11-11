import test from 'node:test';
import assert from 'node:assert/strict';
import { loadModule } from './helpers/load-ts.mjs';

const client = loadModule('src/lib/imports/xplace/handoff-client.ts');
const protocol = loadModule('src/lib/imports/xplace/handoff.ts');
const TOKEN = '3f2b8c1e-4d5a-4b6c-8d7e-9f0a1b2c3d4e';
const OTHER = '11111111-2222-4333-8444-555555555555';
const ORIGIN = 'https://fp.test';

function fakeWindow({ search = '', marker = false } = {}) {
  const listeners = new Set();
  const posted = [];
  const replaced = [];
  const win = {
    location: { origin: ORIGIN, href: `${ORIGIN}/profile/import${search}`, search },
    document: { documentElement: { hasAttribute: (name) => marker && name === 'data-fp-xplace-extension' } },
    history: { state: { s: 1 }, replaceState: (state, unused, url) => replaced.push(url) },
    postMessage: (message, targetOrigin) => posted.push([message, targetOrigin]),
    addEventListener: (type, listener) => { assert.equal(type, 'message'); listeners.add(listener); },
    removeEventListener: (type, listener) => listeners.delete(listener),
  };
  const deliver = (data, { source = win, origin = ORIGIN } = {}) => [...listeners].forEach((listener) => listener({ data, source, origin }));
  return { win, posted, replaced, deliver, listeners };
}
const response = (token, extra = {}) => ({ channel: 'fp-xplace-response', token, ...extra });
const reason = (promise) => promise.then(() => 'resolved', (error) => error.reason);

test('protocol constants and the launch URL match the agreed names', () => {
  assert.equal(protocol.LAUNCH_IMPORT_PARAM, 'fp_import');
  assert.equal(protocol.LAUNCH_TOKEN_PARAM, 'fp_ref');
  assert.equal(protocol.buildXPlaceLaunchUrl(TOKEN), `https://www.xplace.com/il/?fp_import=profile&fp_ref=${TOKEN}`);
  assert.equal(protocol.isHandoffToken(TOKEN), true);
  assert.equal(protocol.isHandoffToken('nope'), false);
});

test('takeHandoffToken accepts only a UUID in the xplace parameter', () => {
  assert.equal(client.takeHandoffToken(fakeWindow({ search: `?xplace=${TOKEN}` }).win), TOKEN);
  for (const search of ['', '?xplace=', '?xplace=abc', `?xplace=${TOKEN}x`, `?other=${TOKEN}`, '?xplace=<script>']) assert.equal(client.takeHandoffToken(fakeWindow({ search }).win), null, search);
});

test('requestHandoffPayload posts a read to its own origin and resolves with the payload for the same token', async () => {
  const { win, posted, deliver, listeners } = fakeWindow();
  const pending = client.requestHandoffPayload(TOKEN, { win, timeoutMs: 1000 });
  assert.deepEqual(posted.map(([m, o]) => [{ ...m }, o]), [[{ channel: 'fp-xplace-request', token: TOKEN, action: 'read' }, ORIGIN]]);
  deliver(response(TOKEN, { payload: { kind: 'profile' } }));
  assert.equal((await pending).kind, 'profile');
  assert.equal(listeners.size, 0, 'listener removed');
});

test('requestHandoffPayload ignores foreign sources, origins, tokens and channels', async () => {
  const { win, deliver, listeners } = fakeWindow();
  const pending = client.requestHandoffPayload(TOKEN, { win, timeoutMs: 1000 });
  deliver(response(TOKEN, { payload: { evil: 1 } }), { source: {} });
  deliver(response(TOKEN, { payload: { evil: 2 } }), { origin: 'https://evil.test' });
  deliver(response(OTHER, { payload: { evil: 3 } }));
  deliver({ channel: 'fp-xplace-ready', token: TOKEN, payload: { evil: 4 } });
  deliver('fp-xplace-response');
  deliver(null);
  assert.equal(listeners.size, 1, 'still waiting');
  deliver(response(TOKEN, { payload: { ok: true } }));
  assert.equal((await pending).ok, true);
});

test('requestHandoffPayload: an error or empty answer means expired, silence means timeout, an abort means cancelled', async () => {
  for (const extra of [{ error: 'not-found' }, {}, { payload: null }]) {
    const { win, deliver } = fakeWindow();
    const pending = reason(client.requestHandoffPayload(TOKEN, { win, timeoutMs: 1000 }));
    deliver(response(TOKEN, extra));
    assert.equal(await pending, 'expired');
  }
  const silent = fakeWindow();
  assert.equal(await reason(client.requestHandoffPayload(TOKEN, { win: silent.win, timeoutMs: 20 })), 'timeout');
  assert.equal(silent.listeners.size, 0);
  const { win } = fakeWindow();
  const controller = new AbortController();
  const pending = reason(client.requestHandoffPayload(TOKEN, { win, timeoutMs: 1000, signal: controller.signal }));
  controller.abort();
  assert.equal(await pending, 'cancelled');
  assert.equal(await reason(client.requestHandoffPayload('not-a-token', { win: fakeWindow().win })), 'expired');
});

test('clearHandoff posts a clear request only for a valid token', () => {
  const { win, posted } = fakeWindow();
  client.clearHandoff('bad', win);
  assert.equal(posted.length, 0);
  client.clearHandoff(TOKEN, win);
  assert.deepEqual({ ...posted[0][0] }, { channel: 'fp-xplace-request', token: TOKEN, action: 'clear' });
  assert.equal(posted[0][1], ORIGIN);
});

test('dropHandoffParam removes only the token from the address bar', () => {
  const { win, replaced } = fakeWindow();
  win.location.href = `${ORIGIN}/projects/new?a=1&xplace=${TOKEN}#top`;
  client.dropHandoffParam(win);
  assert.deepEqual(replaced, ['/projects/new?a=1#top']);
  win.location.href = `${ORIGIN}/projects/new`;
  client.dropHandoffParam(win);
  assert.equal(replaced.length, 1, 'nothing to drop');
});

test('isExtensionInstalled: marker attribute, ready message, or false after the timeout', async () => {
  assert.equal(await client.isExtensionInstalled({ win: fakeWindow({ marker: true }).win }), true);
  const ready = fakeWindow();
  const pending = client.isExtensionInstalled({ win: ready.win, timeoutMs: 1000 });
  ready.deliver({ channel: 'fp-xplace-ready', version: '0.2.0' }, { origin: 'https://evil.test' });
  ready.deliver({ channel: 'fp-xplace-ready', version: '0.2.0' });
  assert.equal(await pending, true);
  assert.equal(ready.listeners.size, 0);
  assert.equal(await client.isExtensionInstalled({ win: fakeWindow().win, timeoutMs: 20 }), false);
});

test('awaitHandoff posts the await message and resolves on the staged message of the same token only', async () => {
  const { win, posted, deliver, listeners } = fakeWindow();
  const pending = client.awaitHandoff(TOKEN, { win, timeoutMs: 1000 });
  assert.deepEqual({ ...posted[0][0] }, { channel: 'fp-xplace-await', token: TOKEN });
  assert.equal(posted[0][1], ORIGIN);
  deliver({ channel: 'fp-xplace-staged', token: OTHER });
  deliver({ channel: 'fp-xplace-staged', token: TOKEN }, { origin: 'https://evil.test' });
  deliver({ channel: 'fp-xplace-staged', token: TOKEN }, { source: {} });
  deliver({ channel: 'fp-xplace-awaiting', token: TOKEN });
  assert.equal(listeners.size, 1);
  deliver({ channel: 'fp-xplace-staged', token: TOKEN });
  assert.equal(await pending, undefined);
  assert.equal(listeners.size, 0);
});

test('awaitHandoff rejects on timeout, on cancel (also an already aborted signal) and for a bad token', async () => {
  const slow = fakeWindow();
  assert.equal(await reason(client.awaitHandoff(TOKEN, { win: slow.win, timeoutMs: 20 })), 'timeout');
  assert.equal(slow.listeners.size, 0);
  const { win } = fakeWindow();
  const controller = new AbortController();
  const pending = reason(client.awaitHandoff(TOKEN, { win, signal: controller.signal }));
  controller.abort();
  assert.equal(await pending, 'cancelled');
  const aborted = new AbortController(); aborted.abort();
  const early = fakeWindow();
  assert.equal(await reason(client.awaitHandoff(TOKEN, { win: early.win, signal: aborted.signal })), 'cancelled');
  assert.equal(early.posted.length, 0);
  assert.equal(await reason(client.awaitHandoff('x', { win })), 'expired');
});
