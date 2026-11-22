# Headhunter listings and minisites: plan (22-11-26)

Status: **plan only, nothing implemented.** Owner thread: "Plan headhunter minisite feature". Open decisions for Or are in section 16; each has a recommended default, so work can start on the defaults.

Execution model (project rules): the thread acts as coordinator and plan validator (Opus 5.5 high reasoning); Sonnet 5.5 medium sub-threads write the code, one work package each. Only this thread's own work is committed. No deploy files, Terraform or LLM model choices change without Or's approval (section 14 and decision D9 list the places where the plan could touch infra, as options).

## 1. The idea in one paragraph

Headhunters and recruitment agencies use Freelance Place only to list their projects. Every project of an approved headhunter carries a tag next to the other status tags: **HEADHUNTER_NAME + MINISITE_URL**. A headhunter who has published 10 or more projects gets a minisite at `freelance-place.com/<handle>` (a path, not a subdomain): the platform's own design language and logo, only that headhunter's projects, plus a custom header block and a contact block. Only the social-share card (image and a few lines) can differ, and only if the headhunter set it. Minisites stay a view over the same project data, so there is one source of truth, one SEO surface and one moderation path.

## 2. What the repo looks like today (verified 22-11-26, main 8c88715)

| Area | Fact | Consequence |
|---|---|---|
| Stack | Next.js 16 / React 19, Firebase Auth session cookie, Firestore through firebase-admin only (`firestore.rules` denies all client access), Cloud Run behind the LB | New data is server-only; every write goes through a route handler. |
| Project record | `projects/{uuid}`: `title, category, description, budget, deadline, skills, ownerUid, clientName, status (open/closed/archived), proposals, createdAt, updatedAt`, optional `importSource`, `sample/unreal/owner.kind` for AI showcase. Public reads in `src/lib/db/projects.ts` (`toPublicProject`, `listFeedProjects`, `listOpenProjects`, `getOpenProject`), cached 60 s with tags `projects`, `project:<slug>`. | The headhunter is **derived from `ownerUid`**, not copied onto the project (section 3.3). |
| Publication rules | `src/lib/seo/publication.ts`: `isListableProject`, `isDiscoverableProject`, `isSyntheticProject`. Showcase (AI) projects are never in SEO. | The minisite reuses these predicates; it never defines its own. |
| The tag row | There is no component literally named LIVE. The row that holds the category, the "סוכן AI" badge (`.ai-agent-badge`, `AI_AGENT_BADGE` in `src/lib/projects/presentation.ts`) and the red "נסגר" badge (`.project-closed-badge`) is `.project-category` in `workspace-home.tsx`, plus `card-footer` in `marketplace.tsx`. **Assumption to confirm with Or:** "next to the LIVE tag" means this status/tag row. | One new badge slot in that row, same style system. |
| Accounts | `profiles/{uid}` (`name, headline, bio, website, email, phone, logo (data URL, up to 2 MB), skills…`). No exclusive role: `profileType` is deliberately deleted on save, a person can be both client and freelancer. `accountSecurity/{uid}` holds `active/restricted/suspended`; writes are blocked for restricted accounts (`accountWriteDenied`). | "Headhunter" is a **capability layered on an account**, not a new account type. |
| Moderation | Moderator = Firebase custom claim `moderator` + recent MFA (`src/lib/security/moderator.ts`), API only (`/api/moderation/accounts`), audit trail in `securityAuditEvents`. No admin UI. | Approval reuses this gate and audit trail; the first admin tool is an API + script, like the seed tool. |
| Routing | Top-level static routes: `signin, messages, membership, profile, projects, categories, guides, skills, about, how-it-works, pricing, faq, glossary, terms, privacy, alternatives, api` and metadata routes `sitemap.xml, robots.txt, llms.txt, llms-full.txt, opengraph-image, icon, apple-icon`, plus `__/auth/*` (proxy), `_next`, and `public/` files (logo, IndexNow key `937d….txt`). | A root `/[handle]` is feasible (Next prefers static segments) but the reserved list must be generated from the real route table, section 4. |
| SEO/AEO | One registry (`registry.ts`), `pageMetadata()` (canonical, hreflang, OG, robots), typed JSON-LD builders (`schema.ts`), `sitemap.ts`, `llms` generators, IndexNow ping from `projects/events.ts`. Policy: no JobPosting/Review/AggregateRating. One shared OG image `/opengraph-image`. `proxy.ts` sets noindex on non-canonical hosts and on query-string variants. | Minisite pages register through the same modules; a per-handle OG image is new work. |
| URL management | This repo has no `apiUrl.ts` / `service_urls.py`. The equivalent single source is `src/lib/seo/site.ts` (`SITE_URL`, `absoluteUrl()`). | All minisite URLs are built with `absoluteUrl('/<handle>')` through one helper; no hard-coded host anywhere (project rule). |
| Tests | `node --test tests/*.test.mjs`, SEO invariants in `tests/seo*.test.mjs`. CI runs tests, typecheck, audit before every deploy. | Each package ships its tests; reserved-route and SEO invariants are tests, not conventions. |

## 3. Data model

Everything below is new Firestore collections, no migration of existing documents, no new composite index in the MVP (see 3.5).

### 3.1 `headhunters/{ownerUid}` (one per account)

```
ownerUid            string   doc id
status              'draft' | 'pending' | 'approved' | 'suspended' | 'rejected'
displayName         string   2 to 60 chars, the name shown in the tag and the header
handle              string   the current handle (section 4), mirrors handles/{handle}
kind                'agency' | 'independent'      (self-declared, shown in the header)
contact             { email?, phone?, whatsapp?, website?, linkedin? }   at least one, validated
header              { tagline?(<=90), about?(<=600), logo?(upload ref), accent? (palette key, not free hex) }
share               { title?(<=70), description?(<=160), image?(upload ref) }   all optional
verification        { method?: 'domain-email' | 'manual', verifiedAt?, note? }   moderator-set
counters            { published: number, lastProjectAt: Timestamp }              maintained server side (3.4)
eligibleAt          Timestamp | null   first time published >= 10
approvedAt/By, rejectedReason, suspendedReason, version (int, like accountSecurity)
createdAt, updatedAt
```

Design notes:
- Free-form colours are not offered: the minisite must stay "in the site's design language", so the editor offers a small set of palette keys that already exist in `globals.css`. Same for fonts, layout and sections: **no custom CSS, HTML or markdown**, which also closes XSS and layout-abuse routes.
- `logo` and `share.image` are **upload references** to Cloud Storage (existing `src/lib/db/storage.ts` and the upload-cleanup job), not data URLs in the document. Profile `logo` today is a 2 MB data URL; that pattern is not copied.

### 3.2 `handles/{handle}` (the uniqueness and redirect ledger)

```
handle      string   doc id, lowercase ASCII
ownerUid    string
state       'active' | 'retired'
pointsTo    string?  for retired: the current handle of the same owner (redirect target)
createdAt, retiredAt
```

Claiming and renaming happen in **one Firestore transaction** that creates the new handle doc, retires the old one (state `retired`, `pointsTo` new) and updates `headhunters/{uid}.handle`. A transaction is the only way two accounts cannot take the same handle. Retired handles are never re-assignable to another owner (hijack protection, and old shared links keep working).

### 3.3 The tag is derived, not copied

`toPublicProject` gets an optional `headhunter: { name, handle }` field. The feed and detail readers in `src/lib/db/projects.ts` resolve it by batching `getAll` over the distinct `ownerUid` values of the page (at most 100 projects, so at most 100 reads, in practice a handful), against `headhunters` documents with `status == 'approved'` and `eligibleAt != null`. Cached with the existing 60 s revalidate and a new tag `headhunters`, invalidated on every headhunter change (same pattern as `invalidateProjectCache`).

Why not denormalise `headhunter` onto each project: rename, suspension and rejection would have to rewrite every project, and a missed write leaves a stale or fraudulent tag live. Derived data has a single source and an immediate kill switch (set `status: 'suspended'`, tags and minisite vanish within a cache cycle).

### 3.4 The 10-project counter

`counters.published` is incremented in the same transaction that creates a project (`POST /api/marketplace/projects`, both the plain and the XPlace-import branch) when the owner has a headhunter record, and decremented when a project becomes `archived` or is removed by moderation. A reconciliation script (`scripts/headhunters/reconcile.ts`, dry run by default, `--commit`) recounts from `projects` and reports drift; it is also the repair tool. Counting at read time would need a composite index on `ownerUid + status`; a counter avoids touching Terraform (see 3.5).

What counts as "published" is in section 5.

### 3.5 Indexes and infra

MVP needs **no Terraform change**: lookups are by document id (`headhunters/{uid}`, `handles/{handle}`) or `ownerUid ==` on `projects` (a single-field query Firestore indexes automatically). The minisite's project list is `where('ownerUid','==',uid)` plus in-memory filtering and sorting (a headhunter has hundreds of projects at most, capped at the page size). If volume ever needs a composite index, that is an infra change and goes to Or first.

## 4. Handle (slug) rules

**Format:** `^[a-z0-9](?:[a-z0-9-]{1,28}[a-z0-9])$`, so 3 to 30 characters, lowercase ASCII letters, digits and single hyphens, no leading or trailing hyphen, no `--`. Stored and compared lowercase; `/Acme` redirects (308) to `/acme`.

**Hebrew and Latin:** the *display name* may be Hebrew, Latin or mixed; the *handle* is Latin only. Reasons: percent-encoded Hebrew paths are unreadable in WhatsApp/LinkedIn shares, break copy-paste in email clients, and make the reserved-word and look-alike checks much weaker. The editor suggests a handle from the display name (Latin names are slugified; Hebrew names get a transliteration suggestion the user must confirm or edit) and shows the live URL preview and availability.

**Reserved names** are not a hand-typed list only. They are the union of:
1. every top-level entry of `src/app` (directories and metadata files) and every file in `public/`, **generated at test time** (`tests/headhunter-reserved.test.mjs` reads the file system), so adding a route such as `/pricing` without reserving it fails CI. At runtime the same list is built from a checked-in `reserved-handles.ts` that this test keeps in sync;
2. platform words: `api, admin, administrator, support, help, contact, mail, www, app, static, assets, cdn, _next, auth, login, logout, signup, account, settings, billing, pay, payment, terms, privacy, blog, news, jobs, job, hr, recruit, recruiters, headhunter, headhunters, agency, agencies, team, careers, status, security, root, null, undefined`;
3. brand and competitor terms (`freelance`, `freelance-place`, `freelanceplace`, `xplace`, `jobmaster`, `alljobs`, `drushim`, `linkedin`, `google`, `facebook`, `wix`, …) kept in one data file, extendable without a deploy-time code change.

**Confusable and impersonation check** at claim time: normalise (strip hyphens, map look-alike characters `0→o, 1→l, rn→m, vv→w`), then compare against the reserved/brand list and against all existing active and retired handles. A near-match is not auto-rejected; it routes the application to **manual review with a flag**, because the approval step (section 6) is a human gate anyway.

**Renames:** allowed, rate-limited (at most one per 30 days, decision D7 in section 16), always through the transaction in 3.2. The old handle becomes a permanent 308 redirect to the current one, the sitemap lists only the current URL, IndexNow is pinged for both. Soft cap on how long a chain can be: `pointsTo` always stores the *current* handle (updated for all retired handles of the owner on each rename), so a redirect is one hop, never a chain.

**Deletion or revocation:** the handle becomes `retired` with no `pointsTo`; the URL returns 410-style "page removed" (`notFound()` with a noindex shell) and is not re-assignable for 12 months, then only by moderator action.

**Routing mechanics:** a single dynamic route `src/app/[handle]/page.tsx`. Static segments always win in Next, so existing pages are unaffected; an unknown handle calls `notFound()` (a real 404, never a 200 soft-404). Handle validity is checked with the regex before any database read, so `/robots.txt`-like or `/.env` probes never hit Firestore. `www` canonical redirect and `proxy.ts` noindex logic keep working unchanged. A new route added later cannot shadow a handle silently, because reserved-name test fails first; a handle already taken cannot be reused as a route, which the test also catches (it checks the live reserved file against the route table in both directions).

Fallback if Or prefers a namespaced path (`/h/<handle>` or `/recruiters/<handle>`): same design, no reserved-route risk, slightly less pretty. See decision D1.

## 5. How "10 projects" is counted

Definition (one function, `countsTowardHeadhunter(record)`, unit-tested, used by the counter and the reconcile script):

A project counts when **all** are true:
- owned by the headhunter account (`ownerUid`), created through the normal publish flow (not `sample`, `unreal`, `owner.kind == 'ai-agent'`);
- `status` is `open` or `closed` (a closed project is a real, previously live listing; **archived or moderator-removed ones do not count**);
- listable (`isListableProject`): public, title and description present;
- passes the existing validation minimums (title 5+, description 20+ chars) **plus a headhunter-specific anti-padding rule**: description at least 80 characters, and not a near-duplicate of another project of the same owner (normalised title+description hash). Duplicates count once.
- an XPlace-imported project counts once per `importSource.key` (already unique per owner).

**Unlock moment:** when `counters.published` first reaches 10, set `eligibleAt`. Before that the headhunter sees a progress meter ("7 מתוך 10 פרויקטים") in their application screen and the tag/minisite are not shown.

**Dropping below 10 (recommended behaviour, decision D3):** the unlock is **sticky**, because the goal of the threshold is to confirm a real headhunter, not to punish natural churn. The minisite and tag stay as long as the account is approved and active. Guard rails instead of a hard 10:
- if `published` drops below 5 through moderation removals, status flips to `pending` for re-review;
- if there is **no open project for 90 days**, the minisite stays reachable but is served `noindex` and dropped from the sitemap (an empty showcase is thin content), and the tag disappears with the last open project anyway because tags are rendered per project;
- a moderator can suspend at any time (section 9).

Alternative (strict): require `open >= 10` live at all times. Rejected as default because headhunters close projects when filled, and it would make the minisite flicker on and off, which is bad for shared links and SEO.

**Edge cases:** projects created before the account became a headhunter count (the counter is initialised by the reconcile script on approval); a restricted/suspended account freezes the counter and hides the minisite; a deleted account hides everything and retires the handle.

## 6. How an account becomes a headhunter

Chosen model: **self-declare, then gated approval**. Not self-serve-only (too easy to impersonate), not invitation-only (does not scale, blocks Or's outreach funnel).

1. **Apply** (`/profile/headhunter`, private path, signed-in user, member rules apply): display name, kind (agency/independent), desired handle with live availability, contact details, website or LinkedIn page, a required attestation ("I am authorised to represent this name and to publish these projects"), accepted headhunter terms.
2. **Eligible automatically** once `published >= 10` (`eligibleAt`). Applying before 10 is allowed (the record sits in `draft`, with a progress meter); the review request is created only when eligible.
3. **Review** by Or/a moderator: checks the name against the website/LinkedIn, brand look-alike flags, sample of projects, duplicate padding. Outcomes: approve, reject with reason (shown to the user, appealable through the existing `accountAppeals` path), request changes.
4. **Verification signal (recommended, optional in MVP):** `verification.method = 'domain-email'`, meaning the contact email is on the same domain as the declared website, confirmed by sending a one-time link (Resend is already the mail transport). A verified headhunter shows a small "מאומת" mark in the minisite header only; the tag itself stays uniform. This is the strongest cheap defence against fake agencies and is the first thing to add after the MVP.
5. **Approval notifies** the headhunter by email (existing `notifications` module) with the minisite URL and a share kit link.

Review tooling in the MVP: moderator-only route `POST /api/moderation/headhunters` (same `moderatorUid()` MFA gate, same `securityAuditEvents` entries) driven by a script `scripts/headhunters/review.ts` (list pending, approve/reject, suspend), exactly how the seed tool works. Phase 2: a Slack review card with Approve/Reject buttons in the existing `#support` app (the interactions endpoint already verifies Slack signatures). No new admin web UI is proposed.

## 7. Tag rendering and placement

**Content:** `{displayName} · freelance-place.com/{handle}`. The URL is built from `absoluteUrl` with the scheme stripped for display; the text is a real link to the minisite.

**Component:** one `HeadhunterTag` in `src/components/headhunter-tag.tsx` (pure, no server-only imports, like `presentation.ts`) used by every surface: workspace feed card, expanded card, `ProjectCard` footer, `/projects/[slug]`, `ProjectCardList` (public discovery cards), the minisite grid. Copy constants live in a new `src/lib/headhunters/presentation.ts`, mirroring `AI_AGENT_BADGE` (no inline Hebrew strings in components).

**Placement:** in the tag row beside the category and the status badges (`.project-category`, after the existing badges), not in the title.

**Interaction rule (important):** in the workspace feed the whole summary is a `<button class="expand-project">`, so a link inside it would be invalid nested interactive content and would steal the expand click. The tag is therefore rendered **as a sibling outside the button**, positioned in the same row with CSS, the same way `studio-open-page` already is.

**Responsive and RTL/a11y:** the URL part is `dir="ltr"` inside a `<bdi>` so Latin text does not reorder in RTL; on narrow screens the URL collapses to `/handle` (the name is truncated with ellipsis before the URL is, because the URL is what identifies); accessible name "פרויקט של {name}, עמוד הסוכנות". Visual style: a distinct tone from `.ai-agent-badge` (pine outline) so the two can never be confused; headhunter tag uses the lime/ink brand pair from the logo, as a pill with a small briefcase glyph. A design pass (Canva/Claude design) is not required, it is one CSS class set.

**Never shown** on AI showcase projects, on archived projects, or when the headhunter record is not `approved` with `eligibleAt`. Showcase and headhunter flags are mutually exclusive by construction (`isSyntheticProject` wins).

## 8. The minisite page

Route `src/app/[handle]/page.tsx`, server-rendered, `dynamic = 'force-dynamic'` like the rest, wrapped in the existing `AppShell`. Nothing about the site chrome changes: same fonts, logo, nav, footer, cards.

**Header component (`HeadhunterHeader`):** logo (headhunter's if set, otherwise an initial avatar like `client-avatar`), display name, kind chip, optional verified mark, tagline, about text, project count ("N פרויקטים פתוחים"), and the contact block. Headhunters configure it in an editor (`/profile/headhunter`, tab "עמוד הסוכנות") with a **live preview that renders the very same component**. Limits: tagline 90, about 600, no links inside text, plain text only (line breaks allowed), image uploads through the existing upload path (type allow-list png/jpg/webp, 1 MB logo, 2 MB share image, compressed with the existing `compress-image.ts`, scanned/cleaned by the upload-cleanup job).

**Contact component (`HeadhunterContact`):** email (mailto), phone (tel), WhatsApp (`wa.me` link built server-side from a validated number), website and LinkedIn (https only, `rel="noopener nofollow ugc"`). At least one is required. Contact details are **public by design** for approved headhunters, shown in the approval attestation, and exposed to crawlers only as visible text (not as structured data, section 10) to limit scraping value. A "הצעה/שאלה בפלטפורמה" button keeps using the existing proposal/messages flow, so the platform conversation path remains the default and the external contact is an addition. Email obfuscation is not used (accessibility, and the address is already public to a logged-out reader).

**Project list:** that owner's `open` projects first (newest first), then a collapsed "נסגרו לאחרונה" group of closed ones, using the existing `ProjectCard` / discovery card components and `filterFeed` for search and period filter so the numbers match the home feed (single definition rule from `feed.ts`). Pagination at 20 with `?page=n` (same canonical pattern as `/projects`). Skill/category chips link to the existing taxonomy pages.

**Empty and edge states:** no open projects: header plus "אין כרגע פרויקטים פתוחים" and noindex (section 10); suspended or unapproved handle: the standard 404; retired handle: 308 to the current handle.

**Project detail page:** the existing `/projects/[slug]` stays the single canonical URL of a project (no `/{handle}/{slug}` duplicate). It gains the tag, a "פרויקטים נוספים של {name}" block (internal link to the minisite) and the breadcrumb `דף הבית › {name} › {project}` for headhunter projects.

## 9. Share and OG metadata (override with fallbacks)

Resolution order, implemented in one function `headhunterShareMeta(record)` so the minisite page and its OG route cannot diverge:

| Field | Headhunter set | Not set (fallback) |
|---|---|---|
| title | `share.title` | `{displayName} | Freelance Place` |
| description | `share.description` | generated from tagline, else the platform description with the open-project count |
| image | `share.image` (re-encoded to 1200x630 on upload) | **generated card** (below), else the platform `/opengraph-image` |

**Generated card:** a per-handle `opengraph-image` route (`ImageResponse` from `next/og`, the pattern already in `src/app/opengraph-image.tsx`) in the platform layout with the Freelance Place logo and the headhunter's name and logo. So "only the social-share details change, and only if the headhunter sets them" holds: the default is the platform look; a custom image replaces only the image, and custom title/description replace only the text. Text is always escaped and length-clamped; image files are re-encoded server-side (never hot-linked).

`pageMetadata()` gets an optional `share` override parameter (title, description, image) so canonical, hreflang, robots and the rest stay on the shared code path. `twitter` and `og` tags are built from the same resolved values.

## 10. SEO and AEO treatment

- **Indexing:** a minisite is indexable when the headhunter is `approved`, the account is active, and there is at least one open project (or, shorter: it is not "thin"). Otherwise `noindex` and out of the sitemap, mirroring `listsProjects` and `indexablePages()`. The handle is `/{handle}` canonical, self-referencing hreflang `he-IL`, same as every other page. Query parameters (`?page=`) follow the `/projects` rule already in `proxy.ts`; other query strings stay noindex.
- **Registry:** minisites are dynamic and cannot live in the static `registry.ts` array. Add a second, dynamic source `indexableHeadhunterPages()` (async, server-only, in `src/lib/seo/headhunters.ts`) consumed by `sitemap.ts` and `llms` generators next to `sitemapProjects()`. Same fail-closed rule: a failed read fails the sitemap rather than publishing a partial one.
- **Sitemap:** `lastmod` from the latest project `updatedAt` or header edit. Pagination pages beyond 1 are listed like `/projects?page=n` if they exist.
- **Structured data:** `CollectionPage` (existing `collectionPageNode`) with an `ItemList` of the open projects, `BreadcrumbList`, and the `WebPage` node. **No `Organization`/`LocalBusiness` node for the headhunter** in the MVP: marking an unverified third party as an organisation entity asserts something the platform cannot vouch for, and policy already bans Review, Rating and JobPosting markup. The headhunter's name appears only in visible text and in the page title; contact details are not emitted as structured data. Revisit `Organization` with `verification.method = 'domain-email'` verified accounts only.
- **AI showcase policy stays separate:** showcase projects have no headhunter tag, are excluded from every minisite list, count and JSON-LD, by the same `isSyntheticProject` predicate. A test asserts that a headhunter-owned synthetic record (impossible through the API, possible through a script) never appears.
- **AEO/llms:** `llms.txt` gets one line for the minisite *index* concept only if Or wants a public directory (`/recruiters`, decision D8); individual minisites are listed in `llms-full.txt` as "Agency pages" with name, URL and open-project count, same note format as other sections. No claims beyond data we hold ("N open projects").
- **IndexNow:** extend `projects/events.ts` `projectEventUrls()` so a headhunter project change also pings its minisite URL; header edits, rename (both URLs), approval and suspension ping the minisite.
- **Duplicate content guard:** project text lives only at `/projects/{slug}`; the minisite shows cards with a 150-char excerpt (same as `ProjectCardList`), so no near-duplicate pages are created.
- **Copy rule from the SEO program:** any marketing copy about the headhunter feature comes from `facts.ts`-style modules (threshold `HEADHUNTER_MIN_PROJECTS = 10` is one exported constant used by the counter, the UI and the public copy), so the "10" in a page can never drift from the rule.

## 11. Abuse and moderation

Risks and the control for each:

| Risk | Control |
|---|---|
| Brand or agency impersonation | Human approval gate; reserved and look-alike check; attestation; verification by domain email (post-MVP, recommended); suspension and takedown path; handle never re-assignable. |
| Fake agency padding to reach 10 | Quality count rule (section 5: length, de-duplication, listable, not archived); reconcile report flags bursts (10 projects in under an hour from a new account); approval review samples them. |
| Reaching the unlock with scraped third-party projects | Existing policy applies: no third-party XPlace import without the owner (memory: freelance-xplace-publisher-contact); imported projects need the existing attestation; moderators remove violators, which decrements the counter. |
| Phishing or spam in header/contact | Plain text only, no custom HTML or links in text, https-only validated URLs, no redirectors, rate limits on edits (`enforceActionLimit`, new action `headhunter.edit`), image re-encoding. |
| Offensive names or content | Same moderation path as projects; reuse the `accountSecurity` state machine. A suspended headhunter loses tag and minisite immediately (derived data, 3.3). |
| Handle squatting | One handle per account, only after application, approval required before it resolves publicly, retired handles protected, rename rate limit. |
| Scraping contact data | Visible text only, no structured-data emission, no listing of contacts in sitemap/llms, rate limit on the page like other public routes (platform-level). |
| Data-protection | Contact details are business contact data the headhunter chooses to publish; the editor says so, and the privacy policy gets one sentence (legal copy change, needs Or's go; `legalUpdated` date moves with it per the 17 Nov precedent). |

Moderation actions all write `securityAuditEvents` with `action: 'headhunter.<verb>'`, actor, target, reason, like `account.restrict`.

## 12. Analytics

Uses the existing GA4 `trackEvent` helper (`src/lib/analytics.ts`) and the dataLayer pattern; no new vendor. Events (parameters are handle and project slug only, never contact details):
`headhunter_tag_click` (surface: feed/detail/card), `headhunter_minisite_view` (handle, source), `headhunter_contact_click` (channel: email/phone/whatsapp/website/linkedin), `headhunter_project_open`, `headhunter_apply_submit`, `headhunter_unlock` (server, on reaching 10).
Server-side counters on `headhunters/{uid}.counters` (`views30d` is deliberately **not** stored per request, to avoid write amplification on a public page); the headhunter dashboard (post-MVP) reads GA4-derived numbers through BigQuery export if Or enables it, otherwise shows only proposals and open/closed counts, which Firestore already has. Funnel for Or: apply → eligible → approved → first minisite share.

Infra note (only if Or chooses D9): a per-headhunter Cloud Scheduler job or BigQuery export would be Terraform changes and need approval; nothing in the MVP needs them.

## 13. Admin tools

MVP: `scripts/headhunters/review.ts` (list pending/approved, show reconcile drift, approve, reject, suspend, force-rename, release handle), `scripts/headhunters/reconcile.ts` (recount counters, dry run by default, `--commit`), moderator API route above. Same conventions as `scripts/seed-projects` (dry run default, explicit `--project`, `--commit`), auth through `gcp-auth`. Phase 2: Slack review cards. Phase 3 (only if volume demands): a moderator page behind the existing MFA claim.

## 14. Phases and MVP cut

**MVP (Phase 1, ~6 work packages, each a Sonnet sub-thread, sequential where noted):**
1. *Foundations:* `src/lib/headhunters/` (types, constants `HEADHUNTER_MIN_PROJECTS`, handle validation, reserved list + CI route-sync test, `countsTowardHeadhunter`, share-meta resolver), pure and fully unit-tested. No UI.
2. *Data + API:* `headhunters`/`handles` collections, apply/edit/rename routes (same-origin check, rate limit, `accountWriteDenied`, body size caps), counter maintenance in project create/archive, reconcile script, tests.
3. *Tag:* `toPublicProject` enrichment (batched, cached, tag invalidation), `HeadhunterTag` in feed, cards, detail, discovery cards; CSS; tests (render snapshot, never on showcase, kill-switch).
4. *Minisite page:* `/[handle]`, header + contact components, project list, redirects/404/noindex rules, project-detail "more from" block and breadcrumb. Visual verification at 1440 and 390 px (Playwright is available) per the CSS gotchas memory.
5. *SEO/share:* share override in `pageMetadata`, per-handle OG image, dynamic sitemap source, llms line, IndexNow events, JSON-LD, SEO invariant tests (`test:seo`).
6. *Review tooling + editor UI:* moderator API + `review.ts`, `/profile/headhunter` apply/editor screens with preview, approval email, analytics events.

Packages 1 to 2 gate the rest; 3, 4 and 5 can run in parallel after 2; 6 last. Release is a normal push-to-main deploy (no deploy file changes), gated behind a feature flag env var `HEADHUNTERS_ENABLED` read like `isXPlaceImportEnabled()` so it can ship dark and be switched on for Or's first design partner. The flag is a runtime env var in the existing service config; adding it to Terraform/`production.env` is a deploy-file change, **asking Or first** (alternative: a Firestore config doc, no infra touch).

**Phase 2:** domain-email verification and the "מאומת" mark, Slack review cards, headhunter dashboard (views, contact clicks, proposals), public directory `/recruiters`, share kit (QR, ready-made post text).
**Phase 3:** custom sections within the fixed design system (e.g. a featured project, a logo wall of clients with approval), per-handle analytics export, `Organization` markup for verified accounts, optional English layer once the site has one.
**Explicitly not planned:** subdomains, custom domains, free-form HTML/CSS, a separate headhunter product surface or billing, headhunter-specific proposals flow changes.

## 15. Risks

- **Root-level handle namespace** is the single biggest design risk: every future top-level route must avoid existing handles. Mitigations in section 4 (generated reserved list, CI test in both directions), plus the namespaced fallback.
- **Soft 404 and crawl waste** from `/[handle]` catching unknown paths: mitigated by regex pre-check and real `notFound()`.
- **Cache staleness of tag after suspension:** up to 60 s by design; the moderator route calls the invalidation helper so it is immediate for the serving instance and bounded for the others.
- **Counter drift:** counters are an optimisation; the reconcile script is the source of truth and runs before each approval.
- **Fake agencies passing a human check:** residual risk, reduced by verification and sampling; the takedown path is instant.
- **Thin-content minisites:** noindex rule for empty or near-empty pages.
- **Perceived paid-listing / endorsement:** the tag reads as an identity, not an endorsement; terms must say the platform does not vouch for the agency beyond the review.
- **Legal copy:** terms and privacy need a short headhunter clause; changes the legal date, Or approves wording.
- **Main moves fast** (memory): fetch main before every push; other chats change legal operator and trial text; the headhunter threshold copy must come from the constant.

## 16. Decisions for Or (each with a recommended default)

| # | Decision | Recommendation |
|---|---|---|
| D1 | URL shape: `/{handle}` at the root, or a namespace like `/h/{handle}` | Root `/{handle}` as you asked, protected by the generated reserved list and CI test. Fall back to `/h/` only if you want zero collision risk. |
| D2 | Handle language | Latin-only handle, Hebrew display name, with a transliteration suggestion in the editor. |
| D3 | Dropping below 10 | Sticky unlock; suspend/re-review only on moderation or long inactivity (90 days without an open project makes the page noindex). Not "must always have 10 open". |
| D4 | What counts as the 10 | Open + closed, real (not showcase), listable, not archived, de-duplicated, description 80+ chars. Lifetime, not per month. |
| D5 | Approval | Manual approval by you for every headhunter in the MVP (self-declare, then review), with domain-email verification added in Phase 2. |
| D6 | Tag before 10 | No tag and no minisite before approval and 10 projects (as you described). Alternative: show a plain "סוכנות" tag from project 1 to motivate; I advise against, it dilutes the signal. |
| D7 | Rename policy | One rename per 30 days, old URL redirects forever. |
| D8 | Public directory of headhunters (`/recruiters`) | Not in MVP; decide after the first 5 headhunters. |
| D9 | Feature flag as an env var (touches `production.env`/Terraform) or a Firestore config doc | Firestore config doc, so no deploy file changes. |
| D10 | Does "LIVE tag" mean the status/tag row (category + סוכן AI + נסגר)? | Yes, I assumed so; there is no literal LIVE element in the code. Please confirm or point me at the exact element. |
| D11 | Free for headhunters, or tied to the membership (paid/trial) rules | Free to list and to have a minisite, in line with "use the site solely for listing"; membership rules unchanged for freelancers. Confirm. |
| D12 | Legal wording (terms/privacy sentence, headhunter terms) | I draft the copy, you approve; the legal date moves. |

## 17. Progress log

- 22-11-26: plan written. No code, no deploy, no infra change. Next step on Or's go: package 1 (foundations) in a Sonnet 5.5 sub-thread, coordinated by this thread.
