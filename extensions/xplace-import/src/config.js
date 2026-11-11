// Every tuning knob of the extension lives in this file: "how hard" the invitation is, limits and the origin.
(function (root) {
  'use strict';
  const FPX = (root.FPX = root.FPX || {});

  // Origin of Freelance Place. `npm run build:dev` rewrites this line (and the manifest) for local testing.
  const FP_ORIGIN = 'https://freelance-place.com';

  function extensionVersion() {
    try { return root.chrome.runtime.getManifest().version; } catch (e) { /* not in an extension context */ }
    try { if (typeof module !== 'undefined') return require('../manifest.json').version; } catch (e) { /* tests only */ }
    return '0.0.0';
  }

  const config = {
    FP_ORIGIN,
    get EXT_VERSION() { return extensionVersion(); },
    XPLACE_HOSTS: ['www.xplace.com', 'xplace.com'],
    XPLACE_ORIGIN: 'https://www.xplace.com',
    HANDOFF_PATHS: { profile: '/profile/import', project: '/projects/new' },

    // --- Invitation knobs ---
    // Own profile / own project: 'always' (every visit), 'daily' (like other pages) or 'never' (pill only).
    AUTO_OPEN_OWN_PAGES: 'always',
    // Any other XPlace page: the card opens by itself at most once per this many hours (0 = never).
    AUTO_OPEN_OTHER_PAGES_HOURS: 24,
    // "Not now" hides the automatic card for this many days.
    SNOOZE_DAYS: 3,

    // --- Layout (Chrome Web Store: never cover XPlace's own controls) ---
    CARD_MAX_WIDTH_PX: 360,
    CARD_MAX_HEIGHT_PERCENT: 70,
    BOTTOM_SHEET_BELOW_PX: 480,

    // --- Capture and hand-off ---
    CAPTURE_WAIT_MS: 15000,
    MAX_PAYLOAD_BYTES: 250000,
    STAGE_TTL_MS: 60 * 60 * 1000,
    HELPER_TAB_TTL_MS: 3 * 60 * 1000,
    MAX_STAGED_ENTRIES: 5,
    URL_WATCH_INTERVAL_MS: 1000,
  };
  FPX.config = config;
  if (typeof module !== 'undefined' && module.exports) module.exports = config;
})(globalThis);
