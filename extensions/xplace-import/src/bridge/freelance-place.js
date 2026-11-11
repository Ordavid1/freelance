// Bridge on Freelance Place pages (the whole origin; see below). Speaks the postMessage protocol of
// src/lib/imports/xplace/handoff.ts with the page and talks to the background worker. No network access.
(function (root) {
  'use strict';
  const FPX = (root.FPX = root.FPX || {});

  const TOKEN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  const MARKER = 'data-fp-xplace-extension';
  const PARAM = 'xplace';

  function start(env) {
    const win = env.window;
    const chrome = env.chrome;
    const version = env.version;
    const loc = win.location;
    // Runs on the whole Freelance Place origin: the profile studio can be rendered on `/` and navigation is
    // client-side, so no document load happens on a hand-off path. The background decides what each page may do.
    if (loc.origin !== FPX.config.FP_ORIGIN) return null;

    const tokenFromUrl = () => { const t = new URLSearchParams(win.location.search).get(PARAM); return t && TOKEN.test(t) ? t : null; };
    const initialToken = tokenFromUrl();
    const post = (message) => win.postMessage(message, loc.origin);
    const answer = (token, extra) => post(Object.assign({ channel: 'fp-xplace-response', token }, extra));
    const send = async (message) => {
      try { return await chrome.runtime.sendMessage(message); } catch (e) { return { ok: false, error: 'extension-unavailable' }; }
    };

    const root_ = win.document.documentElement;
    if (root_) root_.setAttribute(MARKER, version);
    const ready = () => post({ channel: 'fp-xplace-ready', version });
    ready();
    if (win.document.readyState === 'loading') win.document.addEventListener('DOMContentLoaded', () => { if (win.document.documentElement) win.document.documentElement.setAttribute(MARKER, version); ready(); });

    const awaited = new Set();
    // Only for the token in the page's own URL (the one it was loaded with, or the current one).
    const tokenAllowed = (t) => typeof t === 'string' && TOKEN.test(t) && (t === tokenFromUrl() || t === initialToken || awaited.has(t));

    win.addEventListener('message', (event) => {
      if (event.source !== win || event.origin !== loc.origin) return;
      const data = event.data;
      if (!data || typeof data !== 'object') return;
      const token = data.token;
      if (data.channel === 'fp-xplace-request') {
        if (!tokenAllowed(token) || (data.action !== 'read' && data.action !== 'clear')) return;
        send({ type: data.action, token }).then((r) => {
          if (r && r.ok) answer(token, data.action === 'read' ? { payload: r.payload } : {});
          else answer(token, { error: (r && r.error) || 'failed' });
        });
      } else if (data.channel === 'fp-xplace-await') {
        // The launch flow has no token in its URL yet: the page generated one and waits for a payload under it.
        if (typeof token !== 'string' || !TOKEN.test(token)) return;
        send({ type: 'await', token }).then((r) => {
          if (r && r.ok) { awaited.add(token); post({ channel: 'fp-xplace-awaiting', token }); }
          else answer(token, { error: (r && r.error) || 'failed' });
        });
      }
    });

    // Background -> bridge -> page: the payload for an awaited token is ready.
    // The reply tells the background whether the page-side bridge really took the message.
    if (chrome.runtime.onMessage) {
      chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
        if (!msg || msg.type !== 'staged') return false;
        const ok = typeof msg.token === 'string' && awaited.has(msg.token);
        if (ok) post({ channel: 'fp-xplace-staged', token: msg.token });
        if (typeof sendResponse === 'function') sendResponse({ ok });
        return false;
      });
    }
    return { awaited };
  }

  FPX.bridge = { start };
  if (typeof module !== 'undefined' && module.exports) module.exports = FPX.bridge;
  if (typeof chrome !== 'undefined' && chrome.runtime && typeof window !== 'undefined' && typeof module === 'undefined') {
    let version = '0.0.0';
    try { version = chrome.runtime.getManifest().version; } catch (e) { /* ignore */ }
    start({ window, chrome, version });
  }
})(globalThis);
