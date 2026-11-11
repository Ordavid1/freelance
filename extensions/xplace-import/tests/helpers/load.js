'use strict';
const path = require('node:path');
const { JSDOM } = require('jsdom');
const fs = require('node:fs');

const SRC = path.join(__dirname, '..', '..', 'src');
const ORDER = ['config.js', 'shared/clean.js', 'shared/pages.js', 'shared/extract-profile.js', 'shared/extract-project.js', 'shared/payload.js', 'shared/prompt-state.js', 'content/prompt-ui.js', 'content/xplace.js', 'background/service-worker.js', 'bridge/freelance-place.js'];
for (const f of ORDER) require(path.join(SRC, f));
const FPX = globalThis.FPX;

const fixture = (name) => fs.readFileSync(path.join(__dirname, '..', 'fixtures', name), 'utf8');
function dom(html, url = 'https://www.xplace.com/il/u/dana-design') {
  const d = new JSDOM(html, { url, runScripts: 'outside-only', pretendToBeVisual: true });
  // jsdom does not run scripts (we never want it to); inline text is still readable via textContent.
  return d;
}
/**
 * Fake chrome. storage.session and storage.local have separate Maps. tabs.sendMessage returns the reply of the
 * listener registered for that tab (`listenOnTab`), `undefined` when the listener does not reply, and rejects
 * when no listener exists (like Chrome's "Receiving end does not exist").
 */
function fakeChrome(opts = {}) {
  const area = () => {
    const mem = new Map();
    return {
      mem,
      async get(keys) {
        if (keys === null || keys === undefined) return Object.fromEntries(mem);
        const list = Array.isArray(keys) ? keys : [keys];
        return Object.fromEntries(list.filter((k) => mem.has(k)).map((k) => [k, JSON.parse(JSON.stringify(mem.get(k)))]));
      },
      async set(obj) { for (const [k, v] of Object.entries(obj)) mem.set(k, JSON.parse(JSON.stringify(v))); },
      async remove(keys) { for (const k of Array.isArray(keys) ? keys : [keys]) mem.delete(k); },
    };
  };
  const session = area();
  const local = area();
  const calls = { created: [], removed: [], sent: [], updated: [], windows: [] };
  const tabListeners = new Map();
  let nextTab = 100;
  const chrome = {
    runtime: { id: 'ext', onMessage: { addListener() {} }, async openOptionsPage() { calls.options = true; } },
    storage: { session, local },
    tabs: {
      async create(o) { calls.created.push(o); return { id: nextTab++ }; },
      async remove(id) { calls.removed.push(id); },
      async update(id, o) { calls.updated.push([id, o]); },
      async sendMessage(id, m) {
        calls.sent.push([id, m]);
        if (opts.sendFails || !tabListeners.has(id)) throw new Error('Could not establish connection. Receiving end does not exist.');
        let reply;
        const respond = (r) => { reply = r; };
        tabListeners.get(id)(JSON.parse(JSON.stringify(m)), { id: 'ext' }, respond);
        return reply;
      },
    },
    windows: { async update(id, o) { calls.windows.push([id, o]); } },
  };
  return { chrome, calls, mem: session.mem, localMem: local.mem, listenOnTab: (id, fn) => tabListeners.set(id, fn) };
}

/** A sender object shaped like Chrome's for a content script in the top frame of a tab. */
function senderFor(url, tabId = 7, extra = {}) {
  return { id: 'ext', url, origin: new URL(url).origin, frameId: 0, tab: { id: tabId, windowId: 1, url }, ...extra };
}

module.exports = { FPX, dom, fixture, fakeChrome, senderFor, JSDOM };
