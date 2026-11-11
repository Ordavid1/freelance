// Orchestration on XPlace pages: SPA URL watch, invitation state machine, click flows, auto-capture.
// Before a click this script reads only the session globals and the ownership flag (never page content).
(function (root) {
  'use strict';
  const FPX = (root.FPX = root.FPX || {});
  const TOKEN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  const STEP_MS = 250;

  function createController(env) {
    const win = env.win;
    const doc = env.doc || win.document;
    const loc = env.location || win.location;
    const hist = env.history || win.history;
    const chrome = env.chrome;
    const config = env.config || FPX.config;
    const now = env.now || (() => Date.now());
    const storage = env.storage;
    const sleep = env.sleep || ((ms) => new Promise((r) => win.setTimeout(r, ms)));
    const M = FPX.promptUi.COPY.messages;
    const S = FPX.promptState;

    let state = S.normalise(null);
    let ctx = null;
    let lastHref = '';
    let pillHidden = false;
    let cardOpen = false;
    let status = 'idle';
    let message = '';
    let notice = '';
    let forced = false; // an automatic, user-initiated run (helper tab or launch tab) owns the UI
    let busy = false;
    const autoOpened = new Set();
    let timer = null;
    let launchChecks = 0;
    let autoStarted = false;
    let focusNext = null;
    // Context cache: recomputed on URL change, after a debounced script insertion, and (bounded) while incomplete.
    let ctxHref = '';
    let dirty = true;
    let retries = 0;
    let observer = null;
    let dirtyTimer = null;
    const MAX_RETRIES = 10;

    const ui = FPX.promptUi.createPromptUI({
      doc, config,
      handlers: {
        onCta: () => run(),
        onNotNow: () => { state = S.snooze(state, now(), config.SNOOZE_DAYS); S.saveState(storage, state); cardOpen = false; focusNext = 'pill'; render(); },
        onNever: () => {
          state = S.dismissForever(state); S.saveState(storage, state);
          cardOpen = false; notice = M.hiddenNotice; render();
          win.setTimeout(() => { notice = ''; render(); }, 6000);
        },
        onSettings: () => { send({ type: 'open-options' }); },
        onOpenCard: () => { cardOpen = true; focusNext = 'card'; render(); },
        onCloseCard: () => { if (notice) notice = ''; cardOpen = false; focusNext = 'pill'; render(); },
        onHidePill: () => { pillHidden = true; render(); },
      },
    });

    async function send(msg) {
      try { return (await chrome.runtime.sendMessage(msg)) || { ok: false }; } catch (e) { return { ok: false, error: 'extension-unavailable' }; }
    }

    function params() {
      const p = new URLSearchParams(loc.search);
      const ref = p.get('fp_ref');
      return { mode: p.get('fp_import'), ref: ref && TOKEN.test(ref) ? ref : null };
    }

    function paint(model) {
      const opts = focusNext ? { focus: focusNext } : undefined;
      focusNext = null;
      ui.render(model, opts);
    }

    function render() {
      const decision = S.decide(ctx, state, now(), config, true);
      const variant = ctx ? ctx.variant : 'freelancer';
      if (notice) { paint({ notice, pill: false, cardOpen: false, variant, status, message: '' }); return; }
      if (forced) { paint({ pill: false, cardOpen: true, variant, status, message }); return; }
      if (!decision.visible) { paint(null); return; }
      paint({ pill: !pillHidden, cardOpen, variant, status, message });
    }

    function setStatus(s, m) { status = s; message = m || ''; render(); }

    async function waitFor(pred, ms) {
      for (let t = 0; t < ms; t += STEP_MS) { if (pred()) return true; await sleep(STEP_MS); }
      return pred();
    }

    // Fresh parse (used by capture, after the click).
    function currentContext() { return FPX.pages.describeContext(doc, loc.href); }

    // Cached parse (used by the invitation before any click).
    function getContext() {
      const href = loc.href;
      if (href !== ctxHref) { ctxHref = href; ctx = null; dirty = true; retries = 0; }
      const incomplete = !ctx || !ctx.session.loggedIn || (ctx.page.kind !== 'other' && ctx.ownerSignal === null);
      if (dirty || (incomplete && retries < MAX_RETRIES)) {
        if (!dirty) retries += 1;
        ctx = currentContext();
        dirty = false;
      }
      return ctx;
    }

    function markDirty() {
      if (dirtyTimer) return;
      dirtyTimer = win.setTimeout(() => { dirtyTimer = null; dirty = true; }, 500);
    }

    function stripLaunchParams() {
      try {
        const u = new URL(loc.href);
        u.searchParams.delete('fp_import'); u.searchParams.delete('fp_ref');
        hist.replaceState(hist.state, '', `${u.pathname}${u.search}${u.hash}`);
      } catch (e) { /* ignore */ }
    }

    // ---- capture ----
    class Fail extends Error { constructor(code) { super(code); this.code = code; } }

    function profileUrl(page) { return `${config.XPLACE_ORIGIN}/il/u/${encodeURIComponent(page.slug)}`; }

    function ownsProfile(c) {
      if (c.ownerSignal === false) return false;
      if (c.ownerSignal === true) return true;
      return Boolean(c.session.ownSlug) && c.session.ownSlug.toLowerCase() === c.page.slug.toLowerCase();
    }

    async function captureProfile() {
      // The owner flag can appear a moment after the blocks; wait for both.
      await waitFor(() => { const c = currentContext(); return c && (c.ownerSignal !== null || (c.session.ownSlug && c.page.kind === 'profile')); }, 3000);
      let c = currentContext();
      if (!c || c.page.kind !== 'profile') throw new Fail('unreadable');
      if (!ownsProfile(c)) throw new Fail('not-owner');
      await waitFor(() => FPX.profile.isProfileRendered(doc), config.CAPTURE_WAIT_MS);
      c = currentContext() || c;
      if (!ownsProfile(c)) throw new Fail('not-owner');
      return FPX.profile.extractProfile(doc, { url: profileUrl(c.page), ownerSignal: c.ownerSignal });
    }

    async function captureProject() {
      const c = currentContext();
      if (!c || c.page.kind !== 'project') throw new Fail('unreadable');
      if (c.ownerSignal === false) throw new Fail('not-owner');
      const opts = { projectId: c.page.projectId, url: `${config.XPLACE_ORIGIN}/il/job-bids/${c.page.projectId}`, ownerSignal: c.ownerSignal };
      let captured = FPX.project.extractProjectFromDocument(doc, opts);
      if (!captured) {
        try { captured = await FPX.project.fetchLegacyProject(Object.assign({ fetchImpl: env.fetchImpl }, opts)); } catch (e) { captured = null; }
      }
      if (!captured) throw new Fail('unreadable');
      if (captured.ownerSignal === false) throw new Fail('not-owner');
      return captured;
    }

    const ERROR_MESSAGES = {
      unreadable: () => M.errUnreadable,
      'not-owner': (kind) => (kind === 'project' ? M.errNotOwnerProject : M.errNotOwner),
      empty: () => M.errEmpty,
      'too-large': () => M.errTooLarge,
      'no-slug': () => M.errNoSlug,
      fp: () => M.errFp,
    };

    /** Capture -> validate -> stage. `ref` and `closeSender` are used by the helper-tab and launch flows. */
    async function captureAndStage(kind, options) {
      const o = options || {};
      setStatus('busy', kind === 'project' ? M.busyProject : M.busyCapture);
      try {
        const captured = kind === 'project' ? await captureProject() : await captureProfile();
        const checked = FPX.payload.validateCapturedPayload(captured, { maxBytes: config.MAX_PAYLOAD_BYTES });
        if (!checked.ok) throw new Fail(checked.code === 'too-large' ? 'too-large' : checked.code === 'empty' ? 'empty' : 'unreadable');
        const reply = await send({ type: 'stage', payload: checked.payload, ref: o.ref || undefined, closeSender: o.closeSender === true });
        if (!reply.ok) throw new Fail(reply.error === 'too-large' ? 'too-large' : 'fp');
        setStatus('done', reply.closed ? M.doneProfileClosed : (o.closeSender ? M.doneProfileClosed : M.doneStaged));
      } catch (e) {
        const code = e instanceof Fail ? e.code : 'unreadable';
        setStatus('error', (ERROR_MESSAGES[code] || ERROR_MESSAGES.unreadable)(kind));
      }
    }

    async function run() {
      if (busy) return;
      ctx = currentContext() || ctx;
      if (!ctx) return;
      busy = true;
      try {
        if (ctx.variant === 'publisher') {
          setStatus('busy', M.busyOpen);
          const r = await send({ type: 'open-fp', target: 'projects-new' });
          setStatus(r.ok ? 'done' : 'error', r.ok ? M.doneOpened : M.errFp);
        } else if (ctx.variant === 'own-project') {
          await captureAndStage('project');
        } else if (ctx.page.kind === 'profile' && ctx.isOwn) {
          await captureAndStage('profile');
        } else {
          if (!ctx.session.ownSlug) { setStatus('error', M.errNoSlug); return; }
          setStatus('busy', M.busyOpen);
          const r = await send({ type: 'open-helper', slug: ctx.session.ownSlug });
          setStatus(r.ok ? 'done' : 'error', r.ok ? M.doneTabOpen : M.errFp);
        }
      } finally { busy = false; }
    }

    // ---- launch pad and auto-capture (user already consented by clicking in Freelance Place or in the card) ----
    async function maybeAuto(c) {
      const p = params();
      if (!p.mode || autoStarted) return;
      if (p.mode === 'profile' && p.ref) {
        if (!c.session.loggedIn) {
          launchChecks += 1;
          if (launchChecks >= 4) { autoStarted = true; forced = false; notice = M.loginRequired; render(); }
          return;
        }
        autoStarted = true;
        if (!c.session.ownSlug) { notice = M.errNoSlug; render(); return; }
        loc.replace(`/il/u/${encodeURIComponent(c.session.ownSlug)}?fp_import=1&fp_ref=${p.ref}`);
      } else if (p.mode === '1' && c.page.kind === 'profile' && c.session.loggedIn) {
        autoStarted = true;
        // Remove the trigger from the address bar first: a reload, Back or a restored tab must never re-run it.
        stripLaunchParams();
        const check = await send({ type: 'auto-check', ref: p.ref || undefined });
        if (!check.ok || !check.allowed) return; // an ordinary visit: just the invitation
        forced = true; busy = true;
        try { await captureAndStage('profile', { ref: p.ref, closeSender: true }); } finally { busy = false; }
      }
    }

    async function tick() {
      const launching = /[?&]fp_import=/.test(loc.search);
      // Dismissed for good: no parsing at all, only the cheap launch-parameter check above.
      if (state.dismissedForever && !launching && !forced && !notice) { if (ui.host) paint(null); return; }
      const c = getContext();
      const href = loc.href;
      if (href !== lastHref) {
        lastHref = href;
        if (!forced) { cardOpen = false; status = 'idle'; message = ''; }
      }
      if (c && !busy) await maybeAuto(c);
      const narrow = Number(win.innerWidth) < config.BOTTOM_SHEET_BELOW_PX;
      const decision = S.decide(c, state, now(), config, autoOpened.has(href) || narrow);
      if (decision.autoOpenCard && !forced && !notice) {
        autoOpened.add(href);
        cardOpen = true;
        state = S.recordAutoOpen(state, now());
        S.saveState(storage, state);
      }
      render();
    }

    async function start() {
      state = await S.loadState(storage);
      if (typeof win.MutationObserver === 'function') {
        observer = new win.MutationObserver((records) => {
          for (const r of records) for (const n of r.addedNodes) if (n.nodeName === 'SCRIPT') { markDirty(); return; }
        });
        observer.observe(doc.documentElement, { childList: true, subtree: true });
      }
      try {
        if (chrome.storage && chrome.storage.onChanged) chrome.storage.onChanged.addListener((changes, area) => {
          if (area === 'local' && changes[S.KEY]) { state = S.normalise(changes[S.KEY].newValue); tick(); }
        });
      } catch (e) { /* ignore */ }
      await tick();
      timer = win.setInterval(() => { tick(); }, config.URL_WATCH_INTERVAL_MS);
    }
    function stop() { if (timer) win.clearInterval(timer); if (observer) observer.disconnect(); ui.destroy(); }

    return {
      start, stop, tick, run, ui,
      get model() { return { cardOpen, status, message, notice, forced, pillHidden, variant: ctx && ctx.variant }; },
      get state() { return state; },
      handlers: null,
    };
  }

  FPX.content = { createController };
  if (typeof module !== 'undefined' && module.exports) module.exports = FPX.content;
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.storage && typeof window !== 'undefined' && typeof module === 'undefined') {
    if (!window.__fpxXPlaceStarted) {
      window.__fpxXPlaceStarted = true;
      createController({ win: window, chrome, storage: chrome.storage.local }).start();
    }
  }
})(globalThis);
