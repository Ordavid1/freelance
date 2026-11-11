// Background service worker: stages payloads (chrome.storage.session), serves the Freelance Place bridge and opens or
// closes the helper tabs. It performs no network requests and never reads page content.
if (typeof importScripts === 'function') importScripts('../config.js');

(function (root) {
  'use strict';
  const FPX = (root.FPX = root.FPX || {});

  const TOKEN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  const SLUG = /^[\p{L}\p{N}][\p{L}\p{N}_.-]{1,79}$/u;
  const P_STAGE = 'stage:';
  const P_AWAIT = 'await:';
  const P_HELPER = 'helper:';
  const AWAIT_TTL_MS = 15 * 60 * 1000;

  function create(deps) {
    const chrome = deps.chrome;
    const config = deps.config || FPX.config;
    const now = deps.now || (() => Date.now());
    const uuid = deps.randomUUID || (() => root.crypto.randomUUID());
    const session = chrome.storage.session;
    const FP = new URL(config.FP_ORIGIN);

    const isXPlaceSender = (sender) => {
      try {
        if (!sender || !sender.tab || typeof sender.tab.id !== 'number') return false;
        if (sender.frameId !== undefined && sender.frameId !== 0) return false;
        const u = new URL(sender.url || (sender.tab && sender.tab.url) || '');
        return u.protocol === 'https:' && config.XPLACE_HOSTS.includes(u.hostname) && !u.port;
      } catch (e) { return false; }
    };

    // Any main-frame page of the Freelance Place origin. The bridge runs on the whole origin because the profile
    // studio can be rendered on `/` and navigation there is client-side (no document load on a hand-off path).
    function fpPage(sender) {
      try {
        if (!sender || (sender.frameId !== undefined && sender.frameId !== 0)) return null;
        const u = new URL(sender.url);
        return u.origin === FP.origin ? u : null;
      } catch (e) { return null; }
    }

    // Only the two hand-off paths: where the extension itself opens `?xplace=<token>` (fallback flow).
    function fpHandoffUrl(sender) {
      const u = fpPage(sender);
      if (!u) return null;
      const path = u.pathname.replace(/\/+$/, '');
      return path === config.HANDOFF_PATHS.profile || path === config.HANDOFF_PATHS.project ? u : null;
    }

    async function purge() {
      const all = await session.get(null);
      const dead = [];
      const t = now();
      const stages = [];
      for (const [key, value] of Object.entries(all || {})) {
        const live = value && typeof value.expires === 'number' && value.expires > t;
        if (!live) { dead.push(key); continue; }
        if (key.startsWith(P_STAGE)) stages.push([key, value.expires]);
      }
      stages.sort((a, b) => a[1] - b[1]);
      while (stages.length > config.MAX_STAGED_ENTRIES) dead.push(stages.shift()[0]);
      if (dead.length) await session.remove(dead);
    }

    function payloadProblem(payload) {
      if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) return 'invalid-payload';
      if (payload.kind !== 'profile' && payload.kind !== 'project') return 'invalid-payload';
      let text;
      try { text = JSON.stringify(payload); } catch (e) { return 'invalid-payload'; }
      const bytes = typeof TextEncoder !== 'undefined' ? new TextEncoder().encode(text).length : text.length * 3;
      return bytes > config.MAX_PAYLOAD_BYTES ? 'too-large' : null;
    }

    const fpUrl = (kind, token) => `${config.FP_ORIGIN}${kind === 'profile' ? config.HANDOFF_PATHS.profile : config.HANDOFF_PATHS.project}?xplace=${token}`;

    async function openFallback(payload, token) {
      await chrome.tabs.create({ url: fpUrl(payload.kind, token) });
    }

    async function handleStage(msg, sender) {
      if (!isXPlaceSender(sender)) return { ok: false, error: 'unauthorized' };
      const problem = payloadProblem(msg.payload);
      if (problem) return { ok: false, error: problem };
      await purge();
      const t = now();
      const ref = typeof msg.ref === 'string' && TOKEN.test(msg.ref) ? msg.ref : null;
      let awaiting = null;
      if (ref) {
        const got = await session.get(P_AWAIT + ref);
        const entry = got && got[P_AWAIT + ref];
        if (entry && entry.expires > t) awaiting = entry;
      }
      let delivered = false;
      let token;
      if (awaiting) {
        // The page awaits under `ref` and reads with the same token; only its registered tab may read it.
        token = ref;
        await session.set({ [P_STAGE + token]: { payload: msg.payload, expires: t + config.STAGE_TTL_MS, ownerTabId: awaiting.tabId } });
        try {
          const reply = await chrome.tabs.sendMessage(awaiting.tabId, { type: 'staged', token });
          delivered = Boolean(reply) && reply.ok === true;
        } catch (e) { delivered = false; }
        if (delivered) {
          try { await chrome.tabs.update(awaiting.tabId, { active: true }); } catch (e) { /* tab gone */ }
          try { if (typeof awaiting.windowId === 'number') await chrome.windows.update(awaiting.windowId, { focused: true }); } catch (e) { /* ignore */ }
        } else {
          // Nobody took delivery: drop the ref-keyed copy and hand over through a fresh token and a new tab.
          await session.remove(P_STAGE + ref);
        }
      }
      if (!delivered) {
        token = uuid();
        await session.set({ [P_STAGE + token]: { payload: msg.payload, expires: t + config.STAGE_TTL_MS } });
        try { await openFallback(msg.payload, token); } catch (e) { return { ok: false, error: 'open-failed' }; }
      }
      let closed = false;
      if (msg.closeSender === true) closed = await closeHelper(sender);
      return { ok: true, closed };
    }

    async function closeHelper(sender) {
      const id = sender.tab.id;
      const key = P_HELPER + id;
      const got = await session.get(key);
      const entry = got && got[key];
      // Only tabs this extension opened itself (or a launch tab it authorised) are ever closed.
      if (!(entry && entry.expires > now())) return false;
      try { await chrome.tabs.remove(id); } catch (e) { return false; }
      await session.remove(key);
      return true;
    }

    async function handleOpenHelper(msg, sender) {
      if (!isXPlaceSender(sender)) return { ok: false, error: 'unauthorized' };
      if (typeof msg.slug !== 'string' || !SLUG.test(msg.slug)) return { ok: false, error: 'invalid-slug' };
      const url = `${config.XPLACE_ORIGIN}/il/u/${encodeURIComponent(msg.slug)}?fp_import=1`;
      const tab = await chrome.tabs.create({ url, active: true });
      if (tab && typeof tab.id === 'number') await session.set({ [P_HELPER + tab.id]: { expires: now() + config.HELPER_TAB_TTL_MS, used: false } });
      return { ok: true };
    }

    // "May this page capture by itself?" Single use: a helper tab this extension opened (by tab id), or the first
    // check for a live fp_ref that a Freelance Place tab is waiting on. Replays (restore, Back) are denied.
    async function handleAutoCheck(msg, sender) {
      if (!isXPlaceSender(sender)) return { ok: false, allowed: false };
      const t = now();
      if (typeof msg.ref === 'string' && TOKEN.test(msg.ref)) {
        const ak = P_AWAIT + msg.ref;
        const a = await session.get(ak);
        const entry = a && a[ak];
        if (entry && entry.expires > t) {
          if (entry.captureGranted) return { ok: true, allowed: false };
          await session.set({ [ak]: { ...entry, captureGranted: true }, [P_HELPER + sender.tab.id]: { expires: t + config.HELPER_TAB_TTL_MS, used: true } });
          return { ok: true, allowed: true };
        }
        return { ok: true, allowed: false };
      }
      const hk = P_HELPER + sender.tab.id;
      const got = await session.get(hk);
      const h = got && got[hk];
      if (h && h.expires > t && !h.used) {
        await session.set({ [hk]: { ...h, used: true } });
        return { ok: true, allowed: true };
      }
      return { ok: true, allowed: false };
    }

    async function handleOpenFp(msg, sender) {
      if (!isXPlaceSender(sender)) return { ok: false, error: 'unauthorized' };
      if (msg.target !== 'projects-new') return { ok: false, error: 'invalid-target' };
      try { await chrome.tabs.create({ url: `${config.FP_ORIGIN}${config.HANDOFF_PATHS.project}` }); } catch (e) { return { ok: false, error: 'open-failed' }; }
      return { ok: true };
    }

    async function handleOpenOptions(msg, sender) {
      if (!isXPlaceSender(sender)) return { ok: false, error: 'unauthorized' };
      try { await chrome.runtime.openOptionsPage(); } catch (e) { return { ok: false }; }
      return { ok: true };
    }

    async function handleAwait(msg, sender) {
      const u = fpPage(sender);
      if (!u || !sender.tab || typeof sender.tab.id !== 'number') return { ok: false, error: 'unauthorized' };
      if (typeof msg.token !== 'string' || !TOKEN.test(msg.token)) return { ok: false, error: 'invalid-token' };
      await purge();
      const key = P_AWAIT + msg.token;
      const got = await session.get(key);
      const existing = got && got[key];
      // First registration wins until it expires or is cleared; only the same tab may refresh it.
      if (existing && existing.expires > now() && existing.tabId !== sender.tab.id) return { ok: false, error: 'token-in-use' };
      await session.set({ [key]: { tabId: sender.tab.id, windowId: sender.tab.windowId, expires: now() + AWAIT_TTL_MS, captureGranted: Boolean(existing && existing.captureGranted) } });
      return { ok: true };
    }

    // Tokens that came through the await flow are readable only by the registered tab; the URL-token rule applies
    // only to tokens the extension itself generated and put into a Freelance Place URL.
    async function authorisedForToken(token, sender) {
      if (typeof token !== 'string' || !TOKEN.test(token)) return false;
      if (!fpPage(sender) || !sender.tab || typeof sender.tab.id !== 'number') return false;
      const t = now();
      const ak = P_AWAIT + token;
      const sk = P_STAGE + token;
      const got = await session.get([ak, sk]);
      const a = got && got[ak];
      if (a && a.expires > t) return a.tabId === sender.tab.id;
      const st = got && got[sk];
      if (st && typeof st.ownerTabId === 'number') return st.ownerTabId === sender.tab.id;
      const u = fpHandoffUrl(sender);
      return Boolean(u) && u.searchParams.get('xplace') === token;
    }

    async function handleRead(msg, sender) {
      if (!(await authorisedForToken(msg.token, sender))) return { ok: false, error: 'unauthorized' };
      await purge();
      const key = P_STAGE + msg.token;
      const got = await session.get(key);
      const entry = got && got[key];
      if (!entry || entry.expires <= now()) return { ok: false, error: 'not-found' };
      return { ok: true, payload: entry.payload };
    }

    async function handleClear(msg, sender) {
      if (!(await authorisedForToken(msg.token, sender))) return { ok: false, error: 'unauthorized' };
      await session.remove([P_STAGE + msg.token, P_AWAIT + msg.token]);
      return { ok: true };
    }

    const routes = {
      stage: handleStage, 'open-helper': handleOpenHelper, 'auto-check': handleAutoCheck, 'open-fp': handleOpenFp,
      'open-options': handleOpenOptions, await: handleAwait, read: handleRead, clear: handleClear,
    };

    async function handle(msg, sender) {
      if (!msg || typeof msg !== 'object' || typeof msg.type !== 'string' || !Object.prototype.hasOwnProperty.call(routes, msg.type)) return { ok: false, error: 'unknown' };
      if (sender && sender.id && chrome.runtime && chrome.runtime.id && sender.id !== chrome.runtime.id) return { ok: false, error: 'unauthorized' };
      try { return await routes[msg.type](msg, sender || {}); } catch (e) { return { ok: false, error: 'failed' }; }
    }

    function register() {
      chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
        handle(msg, sender).then(sendResponse, () => sendResponse({ ok: false, error: 'failed' }));
        return true;
      });
      if (chrome.runtime.onStartup) chrome.runtime.onStartup.addListener(() => { purge().catch(() => {}); });
      if (chrome.runtime.onInstalled) chrome.runtime.onInstalled.addListener(() => { purge().catch(() => {}); });
    }

    return { handle, purge, register };
  }

  FPX.background = { create };
  if (typeof module !== 'undefined' && module.exports) module.exports = FPX.background;
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage && chrome.storage && chrome.storage.session && typeof module === 'undefined') {
    create({ chrome }).register();
  }
})(globalThis);
