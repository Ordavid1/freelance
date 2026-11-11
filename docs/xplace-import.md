# XPlace link import

Lets a signed-in user bring their own XPlace content into Freelance Place by pasting a link:

- **Profile source**: an "XPlace" button next to LinkedIn, GitHub, Dribbble, Behance and Website in the profile studio. The imported text is compiled with the other sources when the user presses the AI generate button.
- **Project import**: an "ייבוא מ־XPlace" panel at the top of the project composer. It fills the normal review form; the publisher on the XPlace page is compared with the user's publisher profile before publishing.

The feature is **off by default**. Nothing is shown to users and the API refuses requests until `XPLACE_IMPORT_ENABLED=true`.

Design record and decisions: [`.claude/plans/11-11-26-XPlace-Link-Import.md`](../.claude/plans/11-11-26-XPlace-Link-Import.md). This file is the operating guide.

## Enabling and disabling

| Setting | Effect |
|---|---|
| `XPLACE_IMPORT_ENABLED=true` | Shows the XPlace source button and project import panel, accepts the import API calls. |
| unset or any other value | `GET /api/integrations/xplace` answers `{"enabled":false}`, both import routes answer 503 `IMPORT_DISABLED`, publishing a project with import provenance is refused. Existing imported projects are unaffected. |

Set it on the Cloud Run service runtime (server only, never `NEXT_PUBLIC_*`). It is an emergency switch as well: setting it back to anything else stops all XPlace reads immediately.

**Before enabling in production** read "Terms and risk" below. Enabling is Or's decision.

## What users can import

| Link | Imported | Not imported |
|---|---|---|
| Profile `https://www.xplace.com/il/u/<name>` (also `/u/<name>`, `/il/en/u/<name>`) | Headline, public description, member-since date | Photo and logo (never fetched), skills, experience, education, languages, portfolio, links, reviews |
| Project `https://www.xplace.com/project?id=<id>` or `https://www.xplace.com/il/job-bids/<id>` (same ID) | Title, full description, tags (as skills), budget amount, due date, publisher company name | Phone numbers, personal names, logos, bids, files, client details |

Why profiles are thin: XPlace serves only a schema.org summary in the profile HTML. Everything else is loaded by the page from XPlace's internal `/rest/` API, which their `robots.txt` disallows for automated clients. The studio therefore tells users to print their XPlace profile to PDF and attach it as a document (the existing document source) when they want experience, skills and education included.

Both project URL formats carry the same numeric ID. The legacy `/il/job-bids/<id>` page only contains a truncated description in its HTML, so the importer always reads the server-rendered `/project?id=<id>` page.

## How a request is handled

1. Same-origin check, signed-in session, strict body size, attestation checkbox (`attested: true`) and the URL parser (`src/lib/imports/xplace/urls.ts`). Anything that is not an exact XPlace profile or project page is rejected before any network access.
2. Per-account budget `import.xplace`: 10 per 10 minutes and 60 per day, shared by both routes (`src/lib/security/rate-limit.ts`).
3. Per-host spacing of 10 seconds across all instances (XPlace `Crawl-delay: 10`), stored in `securityRateLimits`. A request waits up to 15 s for its slot, otherwise the user gets `RATE_LIMITED` with `Retry-After`.
4. One HTTPS GET to the canonical fetch URL: allowlisted host only, no cookies or credentials, `User-Agent: FreelancePlaceImporter/1.0 (+<site URL>)`, 12 s timeout, at most 2 redirects (each re-validated), 2 MB cap, HTML only.
5. The parser reads an explicit allowlist of fields. Text is cleaned (tags, entities, control characters), length-capped and returned. Nothing is stored at this step and nothing is sent to an LLM.
6. Project import only: the importer's publisher name is compared with `profiles/{uid}.name` (`matchPublisher`). The response tells the UI which confirmation to ask for.
7. Publishing goes through the normal `POST /api/marketplace/projects` with an optional `import` object. The server re-validates it, enforces idempotency per owner (`importSource.key = xplace:project:<id>`), applies the publisher rules and stores `importSource` provenance on the project. `importSource` is never part of the public project.

### Publisher rules

"Publisher" is the user's `profiles/{uid}` document viewed through the publisher form; there is no separate publisher collection. An imported project's display name (`clientName`) is always the verified account name, exactly like a normal project; the self-entered publisher profile name and the name shown on XPlace are never used as the display name (the XPlace name is kept only as `importSource.publisherNameOnSource`). A profile name that normalises to nothing (for example `Ltd.`) still counts as a name and is never overwritten. When publishing finds a mismatch the UI did not know about, the 409 `PUBLISHER_MISMATCH_UNCONFIRMED` carries `profileName` and the UI asks for the confirmation.

| Match | Meaning | Publish step |
|---|---|---|
| `match` | XPlace publisher name matches the profile name | Proceeds. |
| `unknown` | The XPlace page shows no publisher name | Proceeds. |
| `mismatch` | Names differ | Requires the checkbox "I am authorised to publish this project on behalf of the publisher". Stored as `mismatch-confirmed`. |
| `no-profile` | The user has no publisher profile name | The user confirms a name (prefilled from XPlace, else the account name). The server cleans the name (control and bidi characters removed, 2 to 200 characters) and creates the profile with that name only (never email, phone or logo, never overwriting existing fields). Stored as `created`. |

## Data handling

| | |
|---|---|
| Read from XPlace | Link path: public page HTML for one link per user action. Extension path: nothing is read by our servers; the extension reads the user's own page in their browser and the user's browser sends the allowlisted fields to `POST /api/integrations/xplace/ingest`. Pasted text: whatever the user pastes. |
| Used | Only the allowlisted fields above. The project page's embedded data also contains a contact person's name, a phone number and a logo URL; the parser never reads them (tests use canary values to prove it). |
| Stored by Freelance Place | Only after the user publishes a project: the project fields the user confirmed plus `importSource` (provider, key, canonical URL, ID, publisher name as shown on XPlace, match result, timestamp, and implicitly the owner). Profile imports are not stored server-side; the text lives in the editor until the user generates a draft, like other sources. |
| Extension payload | Untrusted client input: strictly validated, every string cleaned, every list and length capped, unknown keys dropped. Held by the extension for one hour under a random token, then deleted (or cleared right after a successful import). The ingest API stores nothing; the result lives in the editor like any other source. `ownerSignal` (XPlace's own "this page is yours" flag) is stored with a published project as provenance, never treated as proof. |
| Logged | `xplace_fetch` and `xplace_import` JSON lines (`source` is `link` or `ingest`) with a SHA-256 of the URL, status and duration. Never the raw URL, pasted text or the user ID. |
| Sent to Vertex AI | Profile import text (link, extension or pasted) only when the user presses the AI generate button, exactly like the other sources. Project import sends nothing to AI. |

## Browser extension hand-off

The extension (`extensions/xplace-import/`) is the primary path; the paste-link importer above is the dark secondary path. Both end in the same editors.

**Flow.** On the user's own XPlace page the extension captures an allowlisted set of sections, the background worker stores the payload for one hour under a random token and opens `<site>/profile/import?xplace=<token>` (profile) or `<site>/projects/new?xplace=<token>` (project). The page's `handoff-client` asks the extension's bridge for the payload, posts it to `POST /api/integrations/xplace/ingest` (`{ payload, attested }`), fills the studio or composer, clears the token and removes it from the address bar. A signed-out visitor is sent to sign-in with the full path and query preserved (`src/lib/auth/safe-next.ts` allows only these two paths with exactly one UUID `xplace` parameter).

**Three ways in (profile studio).** (A) With the extension: "open XPlace and import" generates a token, tells the bridge to expect it and opens `https://www.xplace.com/il/?fp_import=profile&fp_ref=<token>`; the extension captures and stages under that token, the bridge answers `fp-xplace-staged`. (B) Paste text, no extension: the user copies their own profile page and pastes it (kind `profile-text`, cleaned, at most 13 000 characters, used as the AI source as is). (C) Paste link, only with `XPLACE_LINK_IMPORT_ENABLED`.

**Attestation.** The ingest route always requires `attested: true`. The UI sends it automatically only when the payload's `ownerSignal` is `true` ("XPlace זיהתה שהפרופיל/הפרויקט הזה שלכם"); otherwise a required checkbox. Pasted text always needs the checkbox.

**Bridge protocol** (constants in `src/lib/imports/xplace/handoff.ts`, page side in `handoff-client.ts`). Messages are `window.postMessage` with `channel` and `token`, accepted only when `event.source === window` and `event.origin === location.origin`: page to bridge `fp-xplace-request` (`read` keeps the payload, `clear` deletes it) and `fp-xplace-await`; bridge to page `fp-xplace-response`, `fp-xplace-awaiting`, `fp-xplace-staged`, `fp-xplace-ready`. The bridge also sets `data-fp-xplace-extension` on `<html>`.

**Ingest limits.** Rate limit `import.xplace.ingest` (20 per 10 minutes, 120 per day per account), body at most 300 000 bytes. Order: flag, same origin, session, body, attestation, validation, limiter, build. Errors: `INVALID_PAYLOAD` (400, malformed payload or project id mismatch), `INVALID_URL` (400, URL is not an XPlace page of the declared kind), `NOT_ENOUGH_DATA` (422).

**Flags.** `XPLACE_IMPORT_ENABLED=true` turns on the XPlace UI and the ingest route. `XPLACE_LINK_IMPORT_ENABLED=true` additionally enables the two link routes. `GET /api/integrations/xplace` returns `{ enabled, linkImport, extensionUrl }`. `NEXT_PUBLIC_XPLACE_EXTENSION_URL` is the extension's store page (https only); the UI shows an install link only when it is set and the extension is not detected. It is a build-time public variable.

**Rollout order.** 1. Enable `XPLACE_IMPORT_ENABLED` BEFORE the extension is published, so the receiver is ready the moment the first user clicks. 2. Publish the extension. 3. Set `NEXT_PUBLIC_XPLACE_EXTENSION_URL` to the store page and redeploy. 4. Keep `XPLACE_LINK_IMPORT_ENABLED` off unless Or decides otherwise.

## Terms and risk (decision for Or, not legal advice)

Facts verified on 2026-11-11:

- `https://www.xplace.com/robots.txt`: `User-agent: *`, `Allow: /`, `Crawl-delay: 10`, with disallowed patterns including `/*rest/`, `/*jobs*?`, `/*SearchProviders.xpl` and `/*SearchProjects.xpl`. The importer only requests allowed paths, sends one request per user action and keeps the 10 s spacing. `tests/xplace-urls.test.mjs` fails if a built fetch URL ever matches one of the recorded disallow patterns. Re-read robots.txt before widening the importer.
- `https://www.xplace.com/il/terms`: users warrant they own their profile content, which XPlace makes public and indexable. Separate clauses bar selling, duplicating, distributing or creating derivative works of site content, "or any other commercial or public use", and copying or exploiting the site "for any commercial purpose", without XPlace's written consent. The clause on content is framed around material the user did not publish. A keyword search found no explicit ban on automated access.

Assessment:

- The intended use (a user importing their own profile and projects) fits the ownership language, but Freelance Place is a commercial competitor performing the fetch from its own servers. That is a materially different position from the earlier browser extension, which ran in the user's own browser and session.
- Anyone can paste any XPlace link. Ownership is therefore enforced by attestation, provenance on every imported project, per-account and per-host limits, and the existing moderation tools, not by proof.
- XPlace can block the importer's address or User-Agent, or send a notice. The feature degrades to a clear user message (`UPSTREAM_UNAVAILABLE`) and the rest of the product is unaffected.

Recommendation: have counsel review the XPlace terms against this use before enabling it in production. If counsel is uncomfortable, the fallback is the document route (users attach their own PDF) with no server-side reads.

## Draft privacy-policy wording (not applied, legal pages are not edited by this change)

Suggested addition to the "חיבורים ל־GitHub, ל־LinkedIn ול־Dribbble" section of `/privacy`, and a matching row in the information table:

> **ייבוא מ־XPlace.** כשמדביקים קישור לפרופיל או לפרויקט ציבורי ב־XPlace ומאשרים שהתוכן שלכם או שאתם מורשים לייבא אותו, השרת שלנו קורא את הדף הציבורי באותו קישור בלבד, בלי התחברות ובלי עוגיות, ומחזיר לעורך את הכותרת, התיאור והפרטים הציבוריים של הפרופיל או הפרויקט. אנחנו לא קוראים או שומרים מספרי טלפון, שמות אנשי קשר, תמונות או הצעות. בייבוא פרויקט נשמרים רק הפרטים שאישרתם בפרסום, יחד עם הקישור למקור, שם המפרסם כפי שמופיע ב־XPlace ומועד הייבוא. טקסט שיובא לפרופיל נשלח ל־Vertex AI רק בלחיצה על יצירת טיוטה. XPlace היא שירות נפרד ועשויה לקבל בקשת קריאה מהשרת שלנו; פרטי ההתחברות שלכם אליה אינם מועברים אלינו.

## Operations

| Symptom | Cause | What to do |
|---|---|---|
| Users see "לא מצאנו בדף מספיק מידע ציבורי" for a project that looks fine | XPlace changed the page structure. | Parser layers fall back from the embedded JSON to labelled HTML to meta tags. Capture the page, adjust `src/lib/imports/xplace/project.ts` and its fixtures. |
| `UPSTREAM_UNAVAILABLE` spikes | XPlace is down, blocking, or returned 403/429. | Check `xplace_fetch` log status codes. If blocked, set `XPLACE_IMPORT_ENABLED` off and do not retry from other addresses. |
| `RATE_LIMITED` for everyone | The shared 10 s host spacing is saturated. | Expected under load; users retry. Do not lower the spacing. |
| A user reports their project was imported by someone else | Anyone can paste any link. | Use the moderation tools on the project; `importSource` shows who imported it and when. Consider the verification-code follow-up in the plan. |

## Retired

The Chrome extension "Freelance Place — XPlace Import" (v0.1.0) is retired. Delete the draft item in the Chrome Web Store developer dashboard; it must not be submitted.
