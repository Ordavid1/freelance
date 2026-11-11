# XPlace import — extension-first, website receiver, dark link fallback (11-11-26)

Owner: thread "Freelance" / Chrome Web Store submission · Branch: `claude/xplace-link-import` · Production: pushes to `main` auto-deploy, so everything ships through a PR that Or merges. Nothing in this plan deploys anything.

Status legend: `[ ]` open · `[x]` done in this branch · `[~]` partly done · `[!]` needs Or (decision, access or infra approval).

---

## 0. Ground rules for every work package

These come from the project instructions and apply to all code written for this plan.

- Root cause, general solutions, enterprise-grade. No use-case hacks, no patch files, no per-customer special cases.
- Read the code you touch first. This is Next 16, not the Next you know: read the relevant guide in `node_modules/next/dist/docs/` before using a Next.js API (route handlers, caching, headers).
- URL-facing code uses `SITE_URL` / `absoluteUrl()` from `src/lib/seo/site.ts` or `publicAppOrigin()` from `src/lib/auth/session.ts`. Never hard-code `freelance-place.com` or `localhost`. The XPlace host allowlist lives in exactly one module (`src/lib/imports/xplace/urls.ts`).
- Do not touch deployment files: `deploy/*`, `infra/terraform/*`, `.github/workflows/*`, `Dockerfile`, `cloudbuild.yaml`, `scripts/deploy-engine.sh`. The new env flag is documented in `.env.example` only; enabling it in production is an infra step for Or.
- Do not change LLM models or AI configuration. Do not add npm dependencies (HTML handling uses small, tested helpers; `html-to-text` already exists if text conversion is needed).
- Do not use `git checkout` to revert; undo specific edits by hand. Do not commit or push; the coordinator integrates, commits and pushes.
- New tests go in new files named `tests/xplace-*.test.mjs`. Existing tests must stay green (`npm test`). Use the `tests/helpers/load-ts.mjs` loader and stubs, never the network or Firestore in tests.
- Same-origin check, authenticated session (`getCurrentUser`), `enforceActionLimit`, `readJsonBody` and no-store responses on every new API route, exactly like the neighbouring routes.
- Hebrew UI copy mirrors existing copy: imperative plural ("הדביקו", "בדקו"), inclusive forms ("בעלים/ות"), short sentences, brand `Freelance Place` and `XPlace` in Latin, maqaf `־` before Latin words (`ל־XPlace`).
- Honesty guardrails: UI copy states only what the importer really does (public headline, summary and photo for profiles; the public project card for projects). Never claim it imports skills, experience or education from a profile.

---

## 1. Decision (revised 11-11-26 19:24 after Or: "we actually need the extension")

Why the extension is required: users are on XPlace, not on Freelance Place yet. The invitation to migrate has to appear where they already are, prominently. The extension also reads the page in the user's own logged-in session, which gives richer data than any server-side fetch (skills, experience, education), XPlace's own "this page is yours" flags, and no automated scraping from our servers.

Architecture, in priority order:

1. **Browser extension v0.2.0 (primary)** in `extensions/xplace-import/`. Prominent in-page invitation on XPlace for logged-in users; on the user's own profile and own projects it opens a large card; on click it captures an allowlisted set of page sections and hands them to Freelance Place. See §9.
2. **Website receiver (primary)**: hand-off page logic, ingest API, the "XPlace" source button/card in the profile studio, the import-aware project composer, publisher cross-reference and publish provenance. Flag `XPLACE_IMPORT_ENABLED`.
3. **Link importer (secondary, dark)**: the server-side fetch of a pasted public link described in §2 and §3, thin for profiles. Separate flag `XPLACE_LINK_IMPORT_ENABLED`, off by default, because an automated fetch from our servers carries more terms risk than the extension (see the Terms row below). Kept because it is built and tested; Or may delete it.

The earlier Chrome Web Store draft (v0.1.0) is reused: it receives the v0.2.0 package and updated listing text; nothing is submitted without Or.

### Evidence (live fetches, 11-11-26, no login, plain HTTP client)

| Page | What an anonymous server-side fetch returns |
|---|---|
| `https://www.xplace.com/project?id=<id>` (Next.js app) | HTTP 200, ~35 KB, server-rendered. Full title, full description, tags, budget, publisher company name, dates, in the HTML and in the embedded RSC JSON (`self.__next_f.push`). **Also contains personal data** (`userDto` first/last name, `companyDto.tel` phone, logo URL): the importer must never read or emit these. |
| `https://www.xplace.com/il/job-bids/<id>` (legacy AngularJS) | HTTP 200 but the project body is loaded by XHR to `/rest/…`; only the title and a truncated description are in the HTML. Both URL formats carry the same numeric ID, so the importer **normalises both to `/project?id=<id>`**. |
| `https://www.xplace.com/il/u/<slug>` (legacy AngularJS) | HTTP 200, ~450 KB. Only a schema.org block is server-rendered: headline (`itemprop=name`), slogan + about text (`description`), photo/logo URLs, `foundingDate`. Skills, experience, education, languages, portfolio and links load via `/rest/…` XHR and are **not** available to a robots-respecting fetcher. The owner-only widgets (profile completion, "who viewed me") never appear in the anonymous view. |
| `robots.txt` | `User-agent: *  Allow: /`, `Crawl-delay: 10`, with `Disallow: /*rest/`, `/*jobs*?`, `/*SearchProviders.xpl` and similar. Profile and project paths are allowed. The importer sends one request per user action, identifies itself, and enforces a ≥10 s per-host spacing. |
| Terms (`/il/terms`) | Users warrant they own their profile content, which XPlace makes public and indexable. The terms bar copying site content for "commercial or public use" and exploiting the site "for any commercial purpose" without written consent, aimed at content the user did not publish. No explicit anti-automation clause was found by keyword search. **Not legal advice; `[!]` Or decides whether to enable in production, ideally after counsel reviews** (Freelance Place competes with XPlace). |

Consequences:

- Project import is complete and robots-compliant. Profile import is thin by nature (headline, summary, photo). The UI says so and points to the existing PDF/document source for the rest (print the XPlace profile to PDF, drop it in the sources box).
- Data minimisation is part of the design: the project parser reads an allowlist of fields; phone numbers, personal names, logos and bid data are never read.
- Because anyone could paste any XPlace link, **ownership** matters: attestation checkbox, provenance stored with the project, per-user and per-host limits. A verification-code claim (user pastes a code into their XPlace text) is the follow-up if abuse appears (§8).

---

## 2. Product flows

### 2.1 Profile (freelancer view of the profile studio)

1. User opens the profile studio, clicks **XPlace** in "חיבור לפרופילים המקצועיים".
2. Link form: input for `https://www.xplace.com/il/u/<name>` + checkbox "אני הבעלים של הפרופיל הזה ב־XPlace" + **ייבוא**.
3. `POST /api/integrations/xplace/profile` → source card "XPlace יובא ✓" showing the headline, link, a note on what was imported, **הסרת ייבוא**.
4. Generate sends `{ provider: 'xplace', sourceText }` together with the other sources to `/api/ai/profile` (provider allowlist and source count extended).
5. If nothing usable is on the page, the API answers `NOT_ENOUGH_DATA` and the UI explains.

### 2.2 Project (publisher flow, `/projects/new`)

1. Panel at the top of the composer: URL input (both formats) + attestation "אני הבעלים של הפרויקט הזה ב־XPlace או מורשה לפרסם אותו" + **ייבוא**.
2. `POST /api/integrations/xplace/project` returns the draft and a publisher block. The UI fills title, description, skills, category (`כללי`, the user picks), budget (`₪5,000` when an amount exists), deadline (`due date` or `גמיש`; never the XPlace proposal-expiry date) and shows the existing review step.
3. Publisher cross-reference (server decides `match`, UI explains):
   - `match`: the XPlace publisher name matches the user's publisher profile name → "המפרסם ב־XPlace תואם לפרופיל שלך".
   - `mismatch`: names differ → show both, require checkbox "אני מוסמך/ת לפרסם את הפרויקט הזה בשם המפרסם" before publishing.
   - `unknown`: the XPlace page shows no publisher name → "לא זוהה שם מפרסם בדף", no confirmation needed.
   - `no-profile`: the user has no publisher profile yet (empty `profiles/{uid}.name`) → UI offers an editable name (prefilled from the XPlace publisher name, else the account name); publishing **creates** the publisher profile with that name only (no email, phone or logo are copied; the user adds them in the publisher form), never overwriting any existing profile field.
4. Publishing uses the existing `POST /api/marketplace/projects` with an optional `import` object (provenance). Same validation, rate limit, account-state check, moderation hooks and notifications as any project.
5. Re-importing the same XPlace project by the same user is rejected with `ALREADY_IMPORTED` (idempotency by key `xplace:project:<id>` per owner).

"Publisher" in this codebase is the user's `profiles/{uid}` document viewed through the publisher form (no separate publisher entity, see commit "Treat freelancer and hiring as shared UI views rather than account roles"). A project is connected to its publisher through `ownerUid` plus `clientName`. This plan adds no new collection.

---

## 3. Architecture and shared contracts

All shared types live in `src/lib/imports/types.ts`; the URL parser in `src/lib/imports/xplace/urls.ts` is isomorphic (no `server-only`) so the UI validates links with the same code the server uses.

```
src/lib/imports/
  types.ts                      shared contracts (written by the coordinator)
  flag.ts                       isXPlaceImportEnabled()  (XPLACE_IMPORT_ENABLED === 'true')
  safe-fetch.ts                 hardened fetch of one public HTML page         [WP-A]
  host-throttle.ts              Firestore-backed per-host spacing (≥10 s)      [WP-A]
  xplace/
    urls.ts                     parseXPlaceUrl(), canonicalisation             (coordinator)
    profile.ts                  parseXPlaceProfileHtml(html, target)           [WP-A]
    project.ts                  parseXPlaceProjectHtml(html, target)           [WP-A]
    publisher-match.ts          matchPublisher(sourceName, profileName)        (coordinator)
    index.ts                    importXPlaceProfile(url), importXPlaceProject(url)  [WP-A]
src/app/api/integrations/xplace/
  route.ts                      GET  → { enabled }                              [WP-B]
  profile/route.ts              POST → XPlaceProfileImport                      [WP-B]
  project/route.ts              POST → XPlaceProjectImportResponse              [WP-B]
```

### 3.1 Fetch layer (`safe-fetch.ts`)

- Only `https:` and hosts in `XPLACE_HOSTS`; no credentials, no explicit port; the URL passed in is always one produced by `parseXPlaceUrl` (`fetchUrl`).
- `redirect: 'manual'`; at most 2 redirects, each re-validated against the same allowlist.
- 12 s timeout (`AbortSignal.timeout`), response streamed with a hard cap (2 MB), `text/html` only, status 200 only (404 → `NOT_FOUND`, anything else → `UPSTREAM_UNAVAILABLE`).
- Headers: `User-Agent: FreelancePlaceImporter/1.0 (+<SITE_URL>)`, `Accept: text/html`, `Accept-Language: he,en;q=0.8`. No cookies.
- Per-host spacing: transactional Firestore slot (`securityRateLimits`-style doc keyed by a hash of the host) reserving `max(now, last + 10 s)`; waits up to 15 s for its slot, otherwise `RATE_LIMITED` (429, `Retry-After`).
- Never logs the user's URL; logs a SHA-256 of it plus status and duration, in the same JSON style as `profile_generation`.

### 3.2 Parsers

- **Profile**: `<title>`, `meta[name=description]`, `og:*`, `itemprop` meta (name, description, foundingDate). Photo/logo URLs are not imported. Output text is plain, control characters stripped, each field length-capped, `sourceText` ≤ 14 000 chars (same cap the generation route enforces).
- **Project** (layered, first usable wins, always the same allowlist):
  1. Embedded RSC payload: decode every `self.__next_f.push([1,"…"])` string, find the `"project":{…}` object with a string-aware brace scanner, `JSON.parse` it. Read only: `projectId`, `title`, `description`, `amount`, `projectDueDate`, `projectCategories[].nameHe/nameEn`, `companyDto.companyNameHe/companyNameEn`, `dateCreated`, `expirationDate`.
  2. Label-driven HTML fallback: `<h1>`, the paragraph after `<h3>פרטי הפרויקט</h3>`, the `<li>` items of the expertise list, the `תקציב הפרויקט` / `תאריך היעד` labels. No hashed CSS-class dependence beyond stable prefixes.
  3. `og:title` / `og:description` as a last resort → draft marked partial with a warning that the description is truncated.
- Every output string goes through the same cleaning helper (decode entities, strip tags and control characters, collapse whitespace, cap length). Fetched content is untrusted data: nothing is evaluated, nothing is passed to an LLM in this feature.
- Budget: `₪` + thousands-separated amount when `amount > 0`, else empty string (the product already renders `התקציב בשיחה`). Deadline: `projectDueDate` as `dd/mm/yyyy`, else `גמיש`. Skills: category names split on commas, trimmed, de-duplicated, ≤ 20, then the existing `projectSkills()` normalisation is applied by the publish route as usual.

### 3.3 Publisher match (`publisher-match.ts`, pure, unit-tested)

Normalise (NFKC, lowercase, strip niqqud and punctuation, drop legal suffix tokens such as `בעמ`, `ltd`, `inc`, `llc`); split the source name into segments on `|`, `/`, ` - `; result `no-profile` when the profile name is empty (checked first), `unknown` when the source name is empty, `match` when the normalised profile name equals the whole source name or any segment, or when all tokens of the shorter side (at least 3 characters in total) are contained in the longer side; else `mismatch`. Owned by the coordinator (WP-0), not WP-A.

### 3.4 Publish extension (`/api/marketplace/projects` POST, `validation.ts`)

Optional `import` object (strictly validated; unknown keys rejected):

```ts
import: {
  provider: 'xplace';
  url: string;                 // must pass parseXPlaceUrl(); stored canonical
  attested: true;              // required
  publisherNameOnSource?: string;       // ≤ 200, informational
  createPublisherName?: string;         // ≤ 200, only honoured when profile name is empty
  publisherMismatchConfirmed?: boolean;
}
```

Server rules: `attested === true`; derive `externalId` from the canonical URL; idempotency query on `ownerUid` + `importSource.key`; compute `publisherMatch` with `matchPublisher()` against `profiles/{uid}.name`; if `mismatch` and not confirmed → 409 `PUBLISHER_MISMATCH_UNCONFIRMED`; if the profile name is empty → require `createPublisherName`, then (after server-side cleaning: control/bidi characters removed, 2 to 200 characters) merge `{ name, ownerUid, updatedAt }` into `profiles/{uid}` without touching any existing field, inside the same Firestore transaction that creates the project; `clientName` keeps today's rule for every project (`user.name || email local part || 'לקוח/ה'`): the display name stays the verified account name, never the self-entered publisher profile name or the name on XPlace. Stored record gains `importSource: { provider, key, url, externalId, publisherNameOnSource, publisherMatch: 'match' | 'mismatch-confirmed' | 'created', importedAt }`, never exposed by `toPublicProject`.

### 3.5 Profile generation extension (`/api/ai/profile`)

Allowed `socialSources` providers become `github | linkedin | dribbble | xplace`, maximum 4, still unique per provider and ≤ 14 000 chars each. Nothing else about the prompt, model or schema changes.

### 3.6 Rate limits and flag

- New `actionLimits` entry `'import.xplace'`: 10 per 10 minutes, 60 per day, per account (shared by both import routes).
- Flag: `XPLACE_IMPORT_ENABLED=true` required (default `false`, listed in `.env.example`). When off: `GET /api/integrations/xplace` → `{ enabled: false }`, both POST routes → 503 `IMPORT_DISABLED`, and the UI hides the XPlace button and import panel.

### 3.7 API error contract

```ts
type XPlaceImportErrorCode =
  | 'IMPORT_DISABLED' | 'INVALID_URL' | 'ATTESTATION_REQUIRED'
  | 'NOT_FOUND' | 'NOT_ENOUGH_DATA' | 'UPSTREAM_UNAVAILABLE' | 'RATE_LIMITED';
// body: { code, error }  with Hebrew `error`, always Cache-Control: no-store
```

HTTP mapping: 400 `INVALID_URL`/`ATTESTATION_REQUIRED`, 401 unauthenticated, 403 cross-origin, 404 `NOT_FOUND`, 422 `NOT_ENOUGH_DATA`, 429 `RATE_LIMITED`, 502 `UPSTREAM_UNAVAILABLE`, 503 `IMPORT_DISABLED`.

---

## 4. Work packages

Ownership is by file so work packages can run in parallel without edit conflicts.

| WP | Owner files | Done when |
|---|---|---|
| **WP-0** coordinator | `types.ts`, `errors.ts`, `flag.ts`, `xplace/urls.ts`, `xplace/publisher-match.ts`, `tests/xplace-urls.test.mjs`, `tests/xplace-publisher-match.test.mjs`, `rate-limit.ts` (new action), `.env.example`, this plan | foundation tests green |
| **WP-A** importer core | `safe-fetch.ts`, `host-throttle.ts`, `xplace/{profile,project,index}.ts`, `tests/xplace-parsers.test.mjs`, `tests/xplace-fetch.test.mjs`, `tests/fixtures/xplace/*` | unit tests green with sanitised synthetic fixtures; a live check against the three real pages (output limited to allowlisted fields) matches the page content |
| **WP-B** API + publish | `src/app/api/integrations/xplace/**`, `src/app/api/ai/profile/route.ts` (provider list only), `src/app/api/marketplace/projects/route.ts`, `src/lib/projects/validation.ts`, `tests/xplace-routes.test.mjs`, `tests/xplace-project-publish.test.mjs` | route tests green incl. flag-off, auth, origin, attestation, rate-limit, idempotency, mismatch, create-publisher |
| **WP-C** UI | `src/components/profile-studio.tsx`, `profile-studio.module.css`, `profile-source-icons.tsx`, `actions.tsx`, new `xplace-project-import.tsx` (+ css) | typecheck clean; UI states for loading, error codes, disabled flag, partial profile hint, publisher block; no hard-coded origins |
| **WP-D** docs | `docs/xplace-import.md` | how it works, data minimisation, flag, operations, legal note, privacy-text proposal |
| **WP-E** extension v0.2.0 | `extensions/xplace-import/**` | §9.1, §9.2, §9.5 unit tests green, package script verifications pass |
| **WP-F** receiver | `src/app/api/integrations/xplace/**`, `src/lib/imports/**`, `src/lib/security/rate-limit.ts` (ingest limit), `src/lib/projects/validation.ts` (provenance fields), `src/components/profile-studio.tsx`, `profile-studio.module.css`, `profile-source-icons.tsx`, `profile-entry-editor`-style CSS if needed, `actions.tsx`, `xplace-project-import.tsx`, `publisher-profile-setup.tsx` (sign-in `next`), `tests/xplace-*.test.mjs` (new files) | §9.3, §9.4, tests green |
| **WP-G** package and listing | `extensions/xplace-import/scripts/package.mjs` output, Chrome Web Store draft | §9.6 |

Integration (coordinator): `npm test`, `npm run typecheck`, `npm run build`, independent code review (SSRF, PII, auth, idempotency, injection), fixes, PR.

---

## 5. Test plan (minimum)

- URLs: all accepted forms (`/il/u/x`, `/u/x`, `/il/en/u/x`, trailing slash, `http`, no scheme, uppercase host), project formats (`/project?id=`, `/il/job-bids/`, `/job-bids/`), rejects (other hosts, `xplace.com.evil.com`, credentials, ports, non-numeric IDs, huge IDs, path traversal, `/rest/…`, `jobs?` search paths). Robots self-check: no built fetch URL matches a known `Disallow` pattern.
- Fetch: redirect to a foreign host rejected, > 2 redirects rejected, oversize body aborted, non-HTML rejected, timeout, 404 → `NOT_FOUND`, 5xx → `UPSTREAM_UNAVAILABLE`, request carries no cookie header and the identifying User-Agent.
- Parsers: sanitised fixtures for both project page variants and the profile page; PII canary strings (phone, personal name) placed in fixtures must never appear in output; HTML/script injection in title and description is stripped; malformed RSC falls back to HTML; empty page → not enough data.
- Publisher match: equal, segment, token containment, legal suffix, different names, empty profile.
- Routes and publish: see WP-B table.

---

## 6. Rollout

1. Merge PR (Or) → ships dark: flag defaults to false, UI hidden.
2. `[!]` Counsel/Or decision on enabling (see §1 Terms row). Draft privacy-policy wording is in `docs/xplace-import.md`; legal pages are not edited by this PR.
3. `[!]` Set `XPLACE_IMPORT_ENABLED=true` on the production service (infra change, Or).
4. Delete the Chrome Web Store draft "Freelance Place — XPlace Import" (Or) and do not submit the extension.

## 7. Status

- [x] Evidence gathered and recorded (§1)
- [x] WP-0 foundation (types, errors, flag, URL parser + tests, rate-limit action, env flag)
- [ ] WP-A importer core
- [ ] WP-B API + publish
- [ ] WP-C UI
- [x] WP-D docs (`docs/xplace-import.md`, written by the coordinator, includes the privacy-wording proposal)
- [ ] Integration, review, PR

## 8. Follow-ups (not in this PR)

- Ownership claim by verification code placed in the XPlace profile/project text, if abuse appears.
- Richer profile data: a "paste profile text" box, or an XPlace partnership/API if one exists.
- Importing several projects at once (the per-host spacing makes this slow by design).
- Runtime `robots.txt` re-check (currently a tested static allowlist, verified 11-11-26).

---

## 9. Extension-first work (added 11-11-26 19:50, binding for WP-E and WP-F)

### 9.1 Extension v0.2.0 behaviour (`extensions/xplace-import/`)

Manifest V3. `permissions: ["storage"]` only: no `host_permissions`, no `tabs`, no `scripting`, no `webRequest`, no remote code. Content scripts: (1) XPlace pages `https://www.xplace.com/*` and `https://xplace.com/*`, `run_at: document_idle`; (2) the hand-off bridge on exactly `<FP_ORIGIN>/profile/import*` and `<FP_ORIGIN>/projects/new*`, `run_at: document_start`. `FP_ORIGIN` is `https://freelance-place.com` in `src/config.js`; the package script can emit a local build for `http://localhost:3000` (never packaged for the Store).

**Session facts, read on every XPlace page from inline script text only** (regex over `document.scripts[*].textContent`; never read personal-name globals): logged in = `GLOBAL_JS_THIS_COMPANY_ID` present; own profile slug = `GLOBAL_JS_THIS_COMPANY_USER_NAME`; account base = `GLOBAL_JS_THIS_COMPANY_ACC_TYPE_BASE` (`'PROVIDER'` = freelancer; anything else non-empty = publisher). **Page kind**: profile `/il/u/<slug>`, `/u/<slug>`, `/il/en/u/<slug>`; project `/il/job-bids/<id>`, `/job-bids/<id>`, `/project?id=<id>`. **Ownership**: profile `PROFILE_SPA_CURRENT_USER_OWNER = true|false`; legacy project page `PROJECT_PAGE_IS_THIS_COMPANY_OWNER = true|false`; new project page `"isProjectOwner":true|false` inside the page's embedded project JSON. XPlace is a single-page app in places: re-evaluate on URL change (poll `location.href` every second).

**Invitation ("popup hard", inside Chrome Web Store policy)**: a closed Shadow-DOM component, fixed position, Hebrew RTL, `z-index` maximal, never a blocking overlay (no focus trap, no scroll lock, Esc collapses):
- *Pill*: always visible for logged-in users on every XPlace page; small round button with the Freelance Place mark plus one line of text.
- *Card*: large, one value line, two or three benefit bullets, primary CTA, secondary `לא עכשיו`, tertiary `אל תציגו שוב`. Auto-opens (a) on the user's own profile page, (b) on the user's own project pages, (c) on any other XPlace page at most once per 24 h per browser profile.
- State in `chrome.storage.local`: `dismissedForever`, `snoozeUntil` (3 days after `לא עכשיו`), `lastAutoOpen`. Tuning knobs live together in `src/config.js` (`AUTO_OPEN_OWN_PAGES`, `AUTO_OPEN_OTHER_PAGES_HOURS`, `SNOOZE_DAYS`), so "how hard" is one file. A small settings link in the card re-enables after `אל תציגו שוב`.
- Copy (Hebrew, Latin brand names): freelancer on own profile or any page: title `העבירו את הפרופיל שלכם ל־Freelance Place`, bullets `בלחיצה אחת`, `אתם בודקים ועורכים הכול לפני שמירה`, `לא משנים ולא מוחקים דבר ב־XPlace`, CTA `העתקת הפרופיל`. Own project page: title `פרסמו גם את הפרויקט הזה ב־Freelance Place`, bullets `פרסום פרויקטים חינם`, `הטיוטה מוכנה לעריכה ולאישור שלכם`, CTA `ייבוא הפרויקט`. Publisher account on a page that is not its own project: title `פרסמו את הפרויקטים שלכם גם ב־Freelance Place`, CTA opens `<FP>/projects/new` and says to use the button on a project page of theirs.
- *Click flows*: on an owned profile or project page the CTA captures immediately (profile: wait up to 15 s for the Angular blocks to render, then capture what exists). On any other page a freelancer's CTA asks the background worker to open `https://www.xplace.com/il/u/<ownSlug>?fp_import=1` in a new tab; the content script there auto-captures once rendered (the user already consented by clicking) and the background closes that helper tab after staging.
- The component reads **no page content** before a CTA click: only the session facts and the ownership flag.

**Capture** (on click only, allowlist, no network except one same-origin GET described below): profile via the DOM map in §9.2; project via the embedded project JSON of the new page format (`self.__next_f.push` string literals; same decoding and balanced-object scan as `src/lib/imports/xplace/project.ts`), reading only `projectId`, `isProjectOwner`, `title`, `description`, `amount`, `projectDueDate`, `projectCategories[].nameHe|nameEn`, `companyDto.companyNameHe|companyNameEn`. On the legacy `/il/job-bids/<id>` page the content script performs ONE same-origin `fetch('/project?id=<id>', { credentials: 'same-origin' })` at click time and parses that response the same way (the legacy page loads its body by XHR). Output objects: `XPlaceCapturedProfile` / `XPlaceCapturedProject` from `src/lib/imports/types.ts`.

**Hand-off**: content script → `chrome.runtime.sendMessage({ type: 'stage', payload, closeSender?: boolean })` → background verifies the sender is an https XPlace host, the payload is a plain object of kind `profile` or `project` and ≤ 250 KB serialised, stores `{ payload, expires: now + 1 h }` in `chrome.storage.session` under `crypto.randomUUID()`, purges expired entries and opens `<FP_ORIGIN>/profile/import?xplace=<token>` or `<FP_ORIGIN>/projects/new?xplace=<token>`. The bridge implements the protocol in `src/lib/imports/xplace/handoff.ts`; the background serves `read` and `clear` only for senders whose URL origin is `FP_ORIGIN`, whose path is one of the two hand-off paths, and whose `xplace` query value equals the request token.

### 9.2 Real XPlace DOM map (observed 11-11-26 in a logged-in session; the profile page is AngularJS rendered client-side)

- Header: `h1` (id `profile_header_name`) = headline; `#profile_header_slogan` / `h2.slogan` = slogan; a sibling `div` of the `h1` holds the location (`חיפה, ישראל`); `div.solo` = account type (`פרילנסר`). **Skip** `a.callme` (phone) and message links.
- `#profile_about_block`: about text is the text after the block's `div.title`.
- `#profile_languages_block`: `div.inner.languages` each with `div.name` and `div.level`.
- `#profile_company_cats_block` (expertise): repeated groups; each group has `div.inner.industry_title > h3 > span.industry` (industry heading) followed by one or more `div#profile_company_cat_entry_<id> > div.inner.category_entry` containing `div.status` (approval label, skip), a `span` (category/tags line) and `div.category_description`. **Skip** `.industry_rate` (hourly-rate toggles and values).
- `#profile_employments_block`: entries `div#profile_employment_<id>.employment_entry` with `div.date` (spans: month, year, `-`, end or `היום`), `h3.position`, `a.company`, `div.description ul li` (bullets).
- `#profile_educations_block`: entries `div#profile_education_<id>.education_entry` with `div.date`, `h3.degree`, `span.university`, `div.description`.
- `#profile_courses_block`, `#profile_volunteering_block` (entries `#profile_volunteering_<id>`), `#profile_military_exprs_block`, `#profile_patent_block`, `#profile_company_articles_block`: layout not modelled; capture each entry's cleaned text (`otherSections`), skipping the `+ הוסף …` add-links and the pencil images.
- `#profile_links_block`: entries `div#profile_link_<id>.link_entry` with `a.links_url`, `div.links_title`, `div.links_desc`.
- **Never read**: `#profile_reviews_block` (other people's reviews), `#profile_github_block`, `#profile_stackoverflow_block`, `#profile_twitter_block`, `#profile_codepen_new_block`, the "מי צפה בפרופיל שלי" viewers list, the "אחוז השלמת הפרופיל" widget, the portfolio images, `#project_bid_block_*` bids.
- Legacy project page (reference only; the extension reads the new format): `#project_name`, `#project_desc`, `td.budget .value`, `div.cats .value`, inline `PROJECT_PAGE_THIS_PROJECT_ID`.

### 9.3 Hand-off protocol and receiver (WP-F)

Contracts: `src/lib/imports/types.ts` (captured payloads, `XPlaceProfileImport`, `XPlaceProjectImportResponse`, provenance), `src/lib/imports/xplace/handoff.ts` (query param `xplace`, token pattern, message shapes, extension marker attribute), `src/lib/imports/flag.ts` (two flags).

- **Ingest route**: `POST /api/integrations/xplace/ingest`, body `{ payload, attested }`, no network access. Order: master flag → same-origin → session → `readJsonBody(request, 300_000)` → attestation (`attested === true`; the UI sends `true` automatically only when `payload.ownerSignal === true`) → strict validation, cleaning and caps → `enforceActionLimit(uid, 'import.xplace.ingest')` (add to `rate-limit.ts`: 20 per 10 minutes, 120 per day) → build → respond (`Cache-Control: no-store`). Errors use `importErrorResponse`; add `INVALID_PAYLOAD` (400) to `XPlaceImportErrorCode` and the maps.
- **Profile builder**: all strings through `cleanText`; caps: headline 140, slogan 140, location 80, about 1500, languages ≤ 8, expertise ≤ 40 (industry ≤ 80, name ≤ 120, description ≤ 300), employment ≤ 15 (position ≤ 160, company ≤ 120, period ≤ 40, description ≤ 700), education ≤ 10, otherSections ≤ 5 sections × 10 entries × 300 chars, links ≤ 10 (http/https only, ≤ 300). `sourceText` in English labels like the Dribbble source, filled by priority under a hard 14 000-character budget: header + about, employment, education, expertise (industry and name lines first, descriptions only while budget remains), languages, links, other sections. `profile`: `headline`, `bio` = about, `skills` = expertise names split on commas (≤ 20, ≤ 60 each), `experience` lines `period · position, company`, `education` lines `period · degree, institution`, `portfolio` = link lines, `name` = `''` (XPlace shows no personal name). `url` = canonical profile URL from `parseXPlaceUrl`.
- **Project builder**: `projectId` must equal the id in `url`; refactor `project.ts` into raw extraction and one shared `normalizeProject()` (draft fields, budget, deadline, skills) used by the link path and the ingest path; publisher cross-reference exactly as in `/api/integrations/xplace/project`.
- **Shared pipeline**: one server-only module for the repeated route steps (flag, origin, auth, body, attestation, limiter, error mapping, logging) used by all XPlace import routes. The two link-fetch routes additionally require `isXPlaceLinkImportEnabled()`.
- **Flags endpoint**: `GET /api/integrations/xplace` → `{ enabled, linkImport, extensionUrl }`; `extensionUrl` is `NEXT_PUBLIC_XPLACE_EXTENSION_URL` when it is an https URL, else `''`.
- **Provenance**: `ProjectImportProvenance` and `ProjectImportSource` gain `captured: 'extension' | 'link'` and `ownerSignal: boolean | null`; `validateImportProvenance` accepts them (defaults `link` / `null`).
- **Page-side client** `src/lib/imports/xplace/handoff-client.ts` (client only): `takeHandoffToken()`, `requestHandoffPayload(token, { timeoutMs })` (accept responses only when `event.source === window`, `event.origin === location.origin`, same token), `clearHandoff(token)`, `isExtensionInstalled()` (marker attribute or ready message within 1.5 s); after a successful ingest call `history.replaceState` to drop the param.
- **Profile studio UI**: XPlace button when `enabled`; panel: extension detected → explains that the invitation appears on the user's XPlace pages and links to `https://www.xplace.com/`; not detected → install link when `extensionUrl`; the paste-link form only when `linkImport`. On mount with a valid token: bridge → ingest → source card with counts (`N תחומי התמחות · N מקומות עבודה · N תארים`), `הסרת ייבוא`. The signed-out panel's `next` parameter must carry path + search so `?xplace=` survives sign-in. Attestation: when `ownerSignal === true` show `XPlace זיהתה שהפרופיל הזה שלכם.` and send `attested: true`; otherwise a required checkbox.
- **Composer UI**: with `?xplace=` (kind must be `project`) → bridge → ingest → fill the draft and show the existing publisher block; without a hand-off: the existing link panel only when `linkImport`, otherwise a small hint card `בעמוד הפרויקט ב־XPlace לחצו על הכפתור של התוסף` with the install link.

### 9.4 Security and privacy requirements (both packages)

Allowlist capture only (§9.2); never contact data, other people's data, rates, bids or reviews. No `eval`, no remote scripts, no analytics, no logging of page content. Payload only travels extension → the user's own Freelance Place tab → authenticated ingest API. Token: random UUID, one hour, one extension-side store. Everything arriving at the ingest API is untrusted and re-validated; client `ownerSignal` is stored as provenance, never as proof.

### 9.5 Tests and verification

Extension (own `package.json`, `jsdom` as its devDependency, `node --test`): page detection table; session and ownership parsing; profile extraction from synthetic fixtures that mirror §9.2 including canary values inside every "never read" block (phone, viewer names, review text, bid text) that must never appear in the payload; project flight extraction and the legacy fetch path (fetch injected); invitation state machine (pill/card/dismiss/snooze/forever/24 h) with a fake storage; background staging and `read`/`clear` authorisation with a fake `chrome`; bridge protocol; payload cap. Optional Playwright end-to-end (extension loaded, routes mocked) only if the cached browsers work; otherwise skipped and reported. Website: tests in the style of the existing `tests/xplace-*.test.mjs`. Coordinator live check: the extractor is injected into the real logged-in profile tab and its counts are compared with what the page shows.

### 9.6 Chrome Web Store package and listing (WP-G, coordinator)

`npm run package` in the extension folder builds `dist/freelance-place-xplace-import-<version>.zip` deterministically and verifies: permissions exactly `["storage"]`, no `host_permissions`, content-script matches exactly the three patterns above, no `eval`/remote script strings, icons from the Freelance Place logo. The v0.2.0 zip replaces v0.1.0 in the existing draft item; the Hebrew listing text, permission justifications, data-usage answers and test instructions are updated to match. Nothing is submitted without Or's explicit go.
