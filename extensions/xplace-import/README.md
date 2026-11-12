# Freelance Place — XPlace Import (Chrome extension, v0.2.1, Manifest V3)

Helps XPlace users move their **own** profile and projects to Freelance Place. It shows a small invitation on XPlace,
and only after the user clicks does it read an allowlisted part of the page and hand it to Freelance Place for review.
This folder is **not** part of the app's npm workspace: run `npm install` inside it.

## Install unpacked (development)

1. `npm install && npm run build:dev` creates `dist-dev/` (bridge and `FP_ORIGIN` point at `http://localhost:3000`).
2. `chrome://extensions` -> Developer mode -> Load unpacked -> choose `dist-dev/` (or this folder for the production origin).

## Configuration (`src/config.js`, one file for "how hard")

| Knob | Default | Meaning |
| --- | --- | --- |
| `FP_ORIGIN` | `https://freelance-place.com` | Freelance Place origin (rewritten by `build:dev`) |
| `AUTO_OPEN_OWN_PAGES` | `'always'` | Card auto-opens on the user's own profile/project: `'always'`, `'daily'`, `'never'` |
| `AUTO_OPEN_OTHER_PAGES_HOURS` | `24` | Card auto-opens on any other XPlace page at most once per N hours (`0` = never) |
| `SNOOZE_DAYS` | `3` | `לא עכשיו` holds back the automatic card for N days (the pill stays) |
| `CARD_MAX_WIDTH_PX`, `CARD_MAX_HEIGHT_PERCENT`, `BOTTOM_SHEET_BELOW_PX` | `360`, `70`, `480` | Layout limits; below 480 px the card is a bottom sheet |
| `CAPTURE_WAIT_MS` | `15000` | Wait for the Angular profile blocks before capturing what exists |
| `MAX_PAYLOAD_BYTES` | `250000` | Hard cap on a staged payload |
| `STAGE_TTL_MS`, `HELPER_TAB_TTL_MS`, `MAX_STAGED_ENTRIES` | 1 h, 3 min, 5 | Staging lifetime and limits |

### Chrome Web Store review risk

The Web Store "minimal distractions" guideline is the review risk for this extension. That is why the automatic card is
limited to the user's own pages (always) and to other pages once every 24 hours, why the card is a small, clearly labelled
(`Freelance Place · תוסף`), non-blocking corner element (max 360 px wide, max 70% of the viewport height). It never blocks the page and is
dismissible, but it does sit over part of the page in the corner, so it can cover content there. On screens narrower than 480 px it is a bottom
sheet that never opens by itself (pill only; it opens when the user taps the pill), why it can be closed with Esc or a visible close button, why the pill
can be hidden, and why `אל תציגו שוב` hides everything permanently. The card contains a visible data-use disclosure.
Turning the knobs up (for example `AUTO_OPEN_OTHER_PAGES_HOURS: 1`) raises that risk. After `אל תציגו שוב`, the invitation
is re-enabled in the extension options page (chrome://extensions -> Details -> Extension options).

## What it does and does not read (privacy)

- Before a click: only XPlace's session globals (`GLOBAL_JS_THIS_COMPANY_ID`, `..._USER_NAME`, `..._ACC_TYPE_BASE`) and the
  ownership flags (`PROFILE_SPA_CURRENT_USER_OWNER`, `PROJECT_PAGE_IS_THIS_COMPANY_OWNER`, `isProjectOwner`) from inline scripts.
- On click, profile: headline, slogan, location, about, languages, expertise (industry, name, description; never rates),
  employment, education, courses/volunteering/military/patents/articles entries and links. Never phone numbers or message
  links, reviews, profile viewers, completion widget, GitHub/StackOverflow/Twitter/CodePen blocks, portfolio images or bids.
- On click, project: `projectId`, `isProjectOwner`, `title`, `description`, `amount`, `projectDueDate`, category names and the
  company display name. Never user or company contact data, logos or bids. The legacy page does one same-origin
  `fetch('/project?id=<id>')` at click time.
- The payload goes extension -> background (`chrome.storage.session`, one hour) -> the user's own Freelance Place tab, which sends it to its
  authenticated API. No analytics, no remote code, no logging of page content. Permissions: `storage` only; no host permissions; not allowed in incognito (`incognito: not_allowed`).
- Before a click the extension only checks login and page-ownership flags (a cached parse of inline scripts per URL; stopped completely after `אל תציגו שוב`). Launch and auto-capture triggers are single use: the background grants them once per token, and the address-bar parameters are removed before capturing.

## Hand-off protocol

The bridge content script matches the whole Freelance Place origin (`https://freelance-place.com/*`, `run_at: document_start`), not just the two hand-off paths: the
profile studio can be rendered on `/` and navigation there is client-side, so no document load ever happens on a matching hand-off URL. The background
accepts `await` from any main-frame page of that origin; the `?xplace=<token>` URL rule (fallback flow, the extension opens the tab itself) still works only on
`/profile/import` and `/projects/new`, and tokens that came through the await flow are readable only by the registered tab.

Matches `src/lib/imports/xplace/handoff.ts`: `fp-xplace-request` (read/clear), `fp-xplace-response`, `fp-xplace-ready` and the
`data-fp-xplace-extension` attribute. Launch flow from the website: open `https://www.xplace.com/il/?fp_import=profile&fp_ref=<token>`
after posting `fp-xplace-await`; the extension redirects to the user's own profile, captures it, stages it under `<token>`, focuses the
waiting Freelance Place tab (`fp-xplace-staged`) and closes the helper tab.

## Tests and packaging

- `npm test` (Node `--test`, jsdom, fake `chrome`, no network).
- `npm run package` -> `dist/freelance-place-xplace-import-<version>.zip` (deterministic; fails on any plan 9.6 check).
- `npm run build:dev` -> `dist-dev/` (never zipped).
