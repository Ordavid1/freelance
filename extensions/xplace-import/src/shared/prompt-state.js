// Invitation state: persisted flags (chrome.storage.local) and the pure "what to show" decision.
(function (root) {
  'use strict';
  const FPX = (root.FPX = root.FPX || {});

  const KEY = 'fpx_prompt_v1';
  const HOUR = 3600 * 1000;
  const DAY = 24 * HOUR;

  function normalise(raw) {
    const r = raw && typeof raw === 'object' ? raw : {};
    return {
      dismissedForever: r.dismissedForever === true,
      snoozeUntil: Number.isFinite(r.snoozeUntil) ? r.snoozeUntil : 0,
      lastAutoOpen: Number.isFinite(r.lastAutoOpen) ? r.lastAutoOpen : 0,
    };
  }

  async function loadState(area) {
    try { const got = await area.get(KEY); return normalise(got && got[KEY]); } catch (e) { return normalise(null); }
  }
  async function saveState(area, state) {
    try { await area.set({ [KEY]: normalise(state) }); } catch (e) { /* storage unavailable: keep in-memory state */ }
  }

  const snooze = (state, now, days) => ({ ...state, snoozeUntil: now + days * DAY });
  const dismissForever = (state) => ({ ...state, dismissedForever: true });
  const enable = (state) => ({ ...state, dismissedForever: false, snoozeUntil: 0 });
  const recordAutoOpen = (state, now) => ({ ...state, lastAutoOpen: now });

  /**
   * ctx: result of pages.describeContext (or null). Returns { visible, pill, autoOpenCard }.
   * Everything hidden for logged-out users and after "do not show again". The pill stays during a snooze;
   * only the automatic card is held back.
   */
  function decide(ctx, state, now, config, alreadyAutoOpened) {
    const hidden = { visible: false, pill: false, autoOpenCard: false };
    if (!ctx || !ctx.session.loggedIn || state.dismissedForever) return hidden;
    let auto = false;
    if (!alreadyAutoOpened && now >= state.snoozeUntil) {
      const ownPage = ctx.isOwn && (ctx.page.kind === 'profile' || ctx.page.kind === 'project');
      const dailyOk = config.AUTO_OPEN_OTHER_PAGES_HOURS > 0
        && (!state.lastAutoOpen || now - state.lastAutoOpen >= config.AUTO_OPEN_OTHER_PAGES_HOURS * HOUR);
      if (ownPage) auto = config.AUTO_OPEN_OWN_PAGES === 'always' || (config.AUTO_OPEN_OWN_PAGES === 'daily' && dailyOk);
      else auto = dailyOk;
    }
    return { visible: true, pill: true, autoOpenCard: auto };
  }

  FPX.promptState = { KEY, loadState, saveState, snooze, dismissForever, enable, recordAutoOpen, decide, normalise };
  if (typeof module !== 'undefined' && module.exports) module.exports = FPX.promptState;
})(globalThis);
