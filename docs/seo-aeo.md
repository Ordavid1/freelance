# Freelance Place search and answer discovery

## Implemented

The canonical origin is `https://freelance-place.com`. HTTPS requests on `www.freelance-place.com` receive a permanent 308 redirect with the original path and query preserved. The Terraform HTTP redirect sends either website hostname directly to HTTPS on the apex domain. Infrastructure changes are prepared in code and have not been applied by this chat.

The application source was imported from the repository's `app/deployment-readiness` branch. The current checkout now contains the real Next.js application, not only the earlier deployment scaffold.

The legal pages from current `main` are retained, including privacy/terms sitemap entries. The global footer is now `SiteFooter` (see below); the operator name, contact e-mail and legal-update date live in `src/lib/legal/identity.ts`.

### Single sources of truth (foundation)

- `src/lib/seo/facts.ts`: public product facts. Price comes from `PRICE_AGOROT` (`cardcom.ts`), the trial length from `TRIAL_MS` (`membership/state.ts`) and billing availability from `cardcomConfig()` (the same check as the billing status endpoint). FAQ answers, the comparison table row, the payments paragraph and the `llms.txt` facts are generated from these values, so they change when billing is switched on or off and never carry a hand-typed number. Copy while billing is unavailable says the price is planned and payment is not yet available; copy while it is available says posting is free, the trial length, the monthly price and that the membership renews automatically until cancelled.
- `src/lib/seo/registry.ts`: every public page (core pages, categories, guides, skills, hub and info pages) with its title (20-60 characters), description (70-165), optional `published`/`modified` dates and `indexable` flag. `metadataFor(path)`, the sitemap, the footer and `editorialPaths` derive from it. A page is registered only together with its route. Skill pages are indexable only when `skillCompleteness()` passes (definition, deliverables, selection criteria, price drivers, questions and at least 250 words); `guides/index.ts`, `skills.ts`, `hubs.ts` and `info-pages.ts` are empty typed lists that later packages fill. Category data may carry a `metaDescription` when its intro falls outside the description window.
- `src/lib/seo/schema.ts`: typed JSON-LD builders (`organizationNode`, `websiteNode`, `siteGraph()`, `webPageNode`, `articleNode`, `collectionPageNode`, `itemListNode`, `breadcrumbNode`, `faqNode`, `membershipServiceNode`, `withContext`). Pages and components never hand-write JSON-LD.
- `src/lib/seo/site.ts`: `pageMetadata(title, description, path, indexable, options)` with `type: 'article'` dates, `absoluteTitle` and per-page OG image alt, `hreflang` alternates, and `summarize(text, max)` for snippets.

### Server-rendered public pages

- `/`: product explanation, public project links, category navigation, and visible FAQs alongside the interactive workspace.
- `/alternatives/xplace`: Hebrew XPlace.com alternative comparison, selection criteria, source citation, review date, and FAQs.
- `/categories/web-development`, `/categories/design`, `/categories/writing-marketing`, `/categories/video-animation`: original field-specific guidance, related public projects, and category FAQs.
- `/guides/project-brief`: an authored, practical guide with an explicitly educational example.
- `/projects/[slug]`: project-specific metadata (the description is shortened at a word or sentence boundary), canonical URL, and a breadcrumb that includes the category level when the project's category or skills map to a known category. The WebPage markup carries `datePublished`/`dateModified` when the stored timestamps exist and the project's skills as `keywords`.
- Every page renders `SiteFooter` (server component, RTL, responsive): link groups for categories, skills (indexable skill pages only, at most 8), guides (at most 6), Freelance Place pages (home, comparison, hub and info pages) and legal (privacy, terms, contact e-mail). A group with no items is not rendered.

### Content hub and programmatic pages

- **Guides and information pages** share one answer-first template (`src/components/discovery/guide-article.tsx`): H1, a short answer ("בקיצור"), a byline whose date is the structured-data `dateModified`, contents, sections, FAQ, sources with check dates, an optional disclaimer and related reading. Routes hold no copy; text lives in `src/lib/seo/guides/<slug>.ts`, `info-content.ts` and `glossary-data.ts`. Pages: `/guides` (index grouped by audience), `/guides/<slug>` (eight guides for clients and freelancers, next to the older hand-built `/guides/project-brief`), `/pricing`, `/about`, `/how-it-works`, `/faq` and `/glossary` (25 terms, `DefinedTermSet`). `/pricing` and `/faq` read the facts per request, and `Service`/`Offer` markup appears only while billing is available. A FAQPage is emitted once per page, from the questions that are visible on it.
- **Skills**: `/skills` (hub) and `/skills/<slug>` (23 skills across the four categories, from `src/lib/seo/skills.ts` and `skill-data/*.ts`). A skill that fails the content quality gate is `noindex` and unlinked. `src/lib/seo/skill-match.ts` links projects to skills by exact alias, or by a Latin alias of three letters or more as a whole word in the title; a category alone never matches.
- **Projects**: `/projects` is a crawlable index. Page 1 is `/projects`; later pages (`?page=n`) are indexable with their own canonical. With no readable projects it renders an empty state and is `noindex`. It paginates the data layer's 100-project window (see the Firestore index note in the plan). Category and project pages show real counts, related projects (ranked by category and shared skills, then newest), skill links and a category breadcrumb. AI-agent projects stay labelled.
- `src/app/not-found.tsx` is a Hebrew 404 inside the site layout (`noindex`, links to projects, skills and categories).
- Content rules are enforced by `tests/seo-content.test.mjs`: no superlatives or guarantees, no currency amounts except those from `facts.ts`, every external source has an https URL and a check date, answers stay within length limits. Every claim about the product was checked against the code and the Terms and Privacy Policy.

### Home rendering and speed

- `src/app/page.tsx` reads the public feed on the server (`listFeedProjects()`), so the first HTML contains the project cards; if the read fails the client fetches it once, as before. Anonymous visitors see a short welcome panel instead of placeholders. The page has one `h1` and workspace panel headings are not `h2`s.
- `ViewerProvider` (`src/components/viewer-context.tsx`) fetches `/api/auth/session` once. Requests that need an account (access, profile, proposals, saved projects, `?mine=1`, billing) run only for signed-in viewers.
- Firebase Auth loads when the sign-in button is hovered, focused or touched, on the visitor's first pointer, key, touch or wheel event, or after 5 s idle, so crawlers and lab runs never pay for it. The sign-in popup is still opened synchronously in the click handler.
- Heavy views (composer, profile setup, inbox, bid form, proposals) load with `next/dynamic`. Public project reads (`listOpenProjects`, `listFeedProjects`, `getOpenProject`) use `unstable_cache` for 60 s with the tags `projects` and `project:<slug>`. `next.config.ts` sends `Strict-Transport-Security: max-age=31536000` (no `includeSubDomains`, no `preload`).

These pages use per-page titles, descriptions, canonicals, `he-IL`/`x-default` hreflang alternates (self-referencing, because only Hebrew exists), Open Graph, Twitter cards, Hebrew document language and RTL direction. The home `<title>` is the absolute `Freelance Place — פרויקטים לפרילנסרים ופרסום פרויקט בחינם`; other titles use the `| Freelance Place` template. The root layout also sets the browser `theme-color` to the page background. The approved yellow-green logo is used in the app, public header, browser icon, Apple touch icon, and 1200 × 630 social preview. The logo has no tagline.

Root HTML renders dynamically so runtime indexing and verification settings do not get frozen into a container build. CSS, fonts, images, and Next.js rendering assets remain crawlable. Only Hebrew pages currently exist; no invented English URLs or hreflang translations are advertised.

### Indexing controls

`SITE_INDEXABLE=true` is required for production indexing. It is false in `.env.example`; Terraform sets it to true for the production service. Set false on every preview or staging deployment. Unknown hosts also receive `X-Robots-Tag: noindex, nofollow`, even if the environment is enabled. Account routes, APIs, and content-filter query variants receive the same header. Ordinary campaign parameters retain the clean page canonical without blocking indexing.

Account UI routes have HTML noindex metadata as well. They remain crawlable in robots.txt so engines can read that directive; robots.txt is not an authentication control. Existing API authorization remains responsible for protecting account data.

Static demo projects (the four built-in `sample` cards without an owner) are labeled and noindex, and absent from the sitemap and public project structured data. Showcase projects published by the AI agent (`sample: true`, `owner.kind === 'ai-agent'`) are indexable and are in the sitemap, always labeled "סוכן AI" on the page and never marked up as job postings. A shared publication rule permits only open projects with nonempty titles/descriptions and public or legacy-undefined visibility; draft, closed, private and member-only records are excluded consistently from the public feed, detail lookup and sitemap.

The sitemap reads published projects in 1,000-document batches rather than reusing the UI's 100-item limit. It uses stored modification timestamps for projects. Static pages come from the registry and get a `lastModified` only when they declare a real `modified` date (legal pages use the legal update date, the guide and comparison use their stated 2026-11-08 date); the home and category pages have none, so no freshness is invented. Database failures fail the sitemap response instead of publishing a successful empty project list. At more than 49,000 eligible projects it fails explicitly: implement sitemap sharding before that threshold. This keeps the current single sitemap below the 50,000-URL limit. Monitor errors and latency as the catalogue grows.

### Structured data and answer engines

- Organization and WebSite identify the brand consistently: Organization has `alternateName` (פרילנס פלייס), description, `legalName` and a customer-support `contactPoint` from the legal identity, `areaServed: IL` and `knowsLanguage: he`. `sameAs` is emitted only when `src/lib/seo/profiles.ts` lists real profiles (empty today).
- `membershipServiceNode(facts)` (Service + Offer) exists for the pricing page and returns nothing unless billing is available.
- Policy, enforced by `tests/seo-schema.test.mjs`: no `JobPosting`, `Review`, `AggregateRating` or `Rating` markup in any builder output (proposals need a paid membership after the trial, which Google's job-posting policy does not allow), and every URL is absolute on `SITE_URL`.
- CollectionPage and ItemList describe public project discovery.
- BreadcrumbList describes page hierarchy.
- FAQPage uses exactly the questions and answers rendered on the page.
- Article describes the visible authored brief guide.
- Real freelance projects use WebPage, without inventing employment/job posting fields.

JSON-LD serialization escapes script delimiters and Unicode line separators. No invented ratings, reviews, awards, job salaries, live payment offers, affiliation, or superiority measurements are published. FAQ markup is semantic context; this marketplace is not promised Google's restricted FAQ rich results.

### AI crawler access, llms files and IndexNow

- `src/lib/seo/crawlers.ts` is a typed registry of the crawler tokens that `robots.txt` names, each checked against the operator's own documentation on a stated date. Three groups: **search-index** (`Googlebot`, `bingbot`, `OAI-SearchBot`, `PerplexityBot`, `Claude-SearchBot`, `Amzn-SearchBot`, `meta-webindexer`, `Applebot`, `DuckAssistBot`, `YouBot`, `MistralAI-Index`), **user-triggered** (`ChatGPT-User`, `Claude-User`, `Perplexity-User`, `meta-externalfetcher`, `MistralAI-User`, `Amzn-User`) and **training** (`GPTBot`, `ClaudeBot`, `Google-Extended`, `Applebot-Extended`, `CCBot`, `meta-externalagent`, `Amazonbot`, `MistralAI-Training`). A token without official documentation (for example `cohere-ai`, `Bytespider`) is not listed.
- `src/app/robots.ts` emits the `*` group plus one group per token. A crawler obeys only its most specific group, so every named group repeats `Disallow: /api/`. Search and user-triggered crawlers are allowed. Training crawlers are allowed by default; set `AI_TRAINING_CRAWLERS=disallow` to opt out of all of them (the whole site is then disallowed for those tokens). Preview and other non-production deployments emit only `User-agent: *` with `Disallow: /`.
- `/llms.txt` and `/llms-full.txt` are generated from the registry and `facts.ts` (`src/lib/seo/llms.ts`), so they cannot drift from the pages. `llms.txt` follows the llms.txt layout (title, summary, then link sections with one-line notes, `Optional` last); `llms-full.txt` carries the facts, FAQ, category summaries, skills and guides as one markdown document. Both are plain text with `X-Robots-Tag: noindex`. They are navigation aids: they create no ranking privilege and no citation guarantee.
- IndexNow (`src/lib/seo/indexnow.ts`, `src/lib/projects/events.ts`): the key file is `public/937d6e4c8033ee12864f2c5c27fcf898.txt` (served at `/937d6e4c8033ee12864f2c5c27fcf898.txt`, content equal to the key). `INDEXNOW_KEY` can override the key for rotation, and the matching file must then exist in `public/`. Creating or closing a project (`POST` and `PATCH /api/marketplace/projects`) expires the public project cache tags (`projects`, `project:<slug>`) and, after the response, announces the project page, its category page and the `/projects` hub, but only for projects that search engines may index. The submission is a no-op outside production, never throws, has a 3 s timeout, only announces URLs on the site's own origin and logs the HTTP status and URL count, never URLs. Cloud Run keeps this cache per instance, so the immediate expiry helps the instance that handled the write; other instances catch up within the 60 s cache window. Proposal-count changes and `seed:projects --retire` are not hooked.
- `npm run seo:indexnow` bulk-submits every URL of the live sitemap (`--dry-run` prints without sending; `SITE_URL` must be set). Google does not take part in IndexNow; it uses the sitemap.


### XPlace.com positioning

Target: **XPlace.com**, with the comparison at `/alternatives/xplace`. The page answers the “best alternative” selection question, explains the product's approach, and cites `https://www.xplace.com/`, checked on 8 November 2026. The claims used from that public homepage are project/freelancer search, free project posting, and freelancer subscription plans. Competitor prices and unreviewed account functionality are not invented.

The membership statements on the comparison page follow `facts.ts`: when billing is available the page says posting is free, the trial length and the auto-renewing monthly price; when it is not, the price is described as planned and payment as not yet available. Payments between client and freelancer, escrow and payment protection are stated as not offered, matching the terms. No automatic transfer of XPlace accounts, reviews or messages is claimed. Recheck and update the visible comparison date only after reviewing the content again.

## Configuration and launch

1. Production is served from Cloud Run behind the managed domain and is deployed by pushing to `main` (see the deploy workflow). The SEO work ships through that pipeline and changes no DNS, Terraform or workflow file. Preserve unrelated DNS records (email) whenever DNS is edited.
2. Confirm `NEXT_PUBLIC_SITE_URL=https://freelance-place.com` and `SITE_INDEXABLE=true` on production. If changing the `NEXT_PUBLIC_` origin for another environment, rebuild the application; Next.js can inline public variables. All preview environments must use `SITE_INDEXABLE=false`.
3. After every deploy inspect `/robots.txt`, `/sitemap.xml`, `/llms.txt`, canonical tags, redirects and response headers on the actual domain. The sitemap deliberately answers 500 when Firestore cannot be read, so a healthy `200` also proves the production runtime identity can read the projects collection.
4. **Google Search Console.** Add a *Domain* property for `freelance-place.com`; DNS verification covers apex and www. DNS is hosted at Squarespace, so the TXT record goes there. A Google verification TXT record already exists on the domain; the property verifies at once for the Google account that created it, and otherwise needs its own record. A *URL prefix* property is the fallback: supply the exact HTML-tag value as `GOOGLE_SITE_VERIFICATION` in the runtime and restart. Tokens are never fabricated by this code.
5. In Search Console open *Sitemaps*, submit `sitemap.xml` and expect status *Success* with the discovered URL count. Then use *URL inspection* on the home page, `/guides`, `/skills`, one category, one guide and one real project, and *Request indexing* for the first few (Google rate-limits requests; the sitemap carries the rest). Watch *Pages* for "Discovered, currently not indexed" and canonical selection, and *Performance* for real queries.
6. **Bing Webmaster Tools.** Use *Import from Google Search Console* once Google is verified (it brings the sitemap with it), or supply `BING_SITE_VERIFICATION`. Bing's index underpins Copilot and other search products, so this is also an AEO step.
7. **IndexNow.** Confirm `https://freelance-place.com/937d6e4c8033ee12864f2c5c27fcf898.txt` returns the key, then run `SITE_URL=https://freelance-place.com npm run seo:indexnow -- --dry-run` and once without `--dry-run` for the initial bulk submission. Later project publish and close events submit themselves. Google ignores IndexNow.
8. **AI crawler policy.** Search-index and user-triggered AI crawlers are always allowed. Training crawlers are allowed by default; set `AI_TRAINING_CRAWLERS=disallow` on the runtime to opt out of all of them. Changing it needs only a restart.
9. Check structured data in Schema.org Validator and Google's Rich Results Test. Monitor page indexing, real search queries, canonical selection, sitemap errors and response status codes. Ask the assistants you care about (ChatGPT search, Perplexity, Gemini, Copilot) the questions the pages answer and note which pages are cited; that is the AEO feedback loop.
10. Measure mobile Core Web Vitals on production: LCP at most 2.5s, INP at most 200ms, CLS at most 0.1 at the 75th percentile. These are targets, not measured results from this change.
11. Review comparison claims, category guidance, billing status and FAQs whenever product behavior changes; the trial length and price come from code, but authored prose is checked by the content lint. Build useful original resources and real public inventory before expanding the page count. Earn relevant editorial links; avoid manufactured reviews and duplicate doorway pages.

No code setting guarantees first place, a “best” designation in every comparison, search inclusion, or an AI citation. The implementation provides discoverable, consistent source content; rankings and citations remain external outcomes.

## Checks

- `npm run test:seo` runs every `tests/seo*.test.mjs`:
  - `seo` and `seo-schema`: publication and privacy rules, pagination beyond 100 records, database failure behavior, preview controls, canonicals, redirects, JSON-LD builders (policy, absolute URLs, escaping, Organization fields).
  - `seo-foundation`: facts and billing-dependent copy, metadata v2, registry invariants, sitemap `lastModified` policy, footer.
  - `seo-content`: the content lint for authored data (skills, guides, glossary, info pages, category questions). It rejects banned superlatives, hand-typed prices and durations (only the values from `facts.ts` are allowed, and they are read from the code constants), Latin text glued to Hebrew, URLs outside `sources`, unknown related links, missing check dates, placeholders, and an incomplete catalogue.
  - `seo-taxonomy`, `seo-guide-article`, `seo-pages`: category, skill, guide, glossary, `/projects` and info page rendering, FAQ markup equal to the visible text, breadcrumbs, pagination and listing rules.
  - `seo-crawlers`, `seo-llms`, `seo-indexnow`, `seo-footer`, `seo-loader`: the crawler registry and `robots.txt`, the llms files, IndexNow behavior and lifecycle hooks, the footer, and the TypeScript test loader itself.
  New tests use `loadModule` from `tests/helpers/load-ts.mjs`.
- `npm run test:home` (server-rendered home feed) and the other suites keep their own scripts.
- `npm run typecheck`
- `npm run build`

A running-server check should additionally inspect rendered HTML and HTTP headers with a canonical Host header, then repeat with a preview host. Test the production domain after each deploy; localhost results do not establish live indexing.

### Verification in this checkout

(Original launch check; the foundation package re-ran the full suite, a billing-on and billing-off crawl of `/`, the comparison, a category and the guide, and footer screenshots at 390 px and 1440 px with no horizontal overflow.) Nine SEO regression tests, Next.js type checking, and the production build passed. Running-server checks confirmed indexable public metadata on the canonical host, noindex on account/demo pages, the www redirect, valid rendered JSON-LD, 404 handling, crawler files, the social image, and preview-host protection. A separate server using the same build confirmed runtime preview blocking and runtime verification-tag configuration.

Chromium checks at 1440px desktop and 390px mobile confirmed the comparison page layout. All comparison columns are readable as stacked rows on mobile, with no page or table horizontal overflow. The mobile home page also had no horizontal overflow and rendered one primary H1.

Terraform formatting and validation passed without applying infrastructure or accessing remote Terraform state. A missing Linux checksum for the already pinned Google Beta provider was added from HashiCorp's signed release metadata; no provider version changed.

The Firestore-backed sitemap was tested through a mocked data boundary for publication policy, pagination, errors and URL-limit handling. After the foundation package deployed on 10 November 2026, the live `/sitemap.xml` answered 200 with 24 URLs, including the project pages, which confirms the production runtime identity reads Firestore.

#### Second increment (10 November 2026)

Checked on the branch after merging the latest `main`, which by then carried another change that moved the trial from 14 to 60 days:

- All suites pass: 175 SEO tests, 31 billing, 12 home, 9 seed and 3 proposal tests. The type check and the production build pass.
- A crawl of the built app with billing on followed every internal link from `/` and visited 53 URLs: all answered 200, every indexable page has exactly one `<h1>` and an absolute canonical on the site origin, account pages answer `X-Robots-Tag: noindex, nofollow`, and every JSON-LD block parses.
- `/pricing`, `/faq` and `/llms.txt` print the trial length from the code constant (60 days) and no stale 14-day text remains. The content lint now reads the allowed trial and price numbers from the same constants and requires the whole planned catalogue (skills, guides, glossary, category questions) on every run.
- `robots.txt` lists the search-index, user-triggered and training crawler groups, each repeating `Disallow: /api/`.
- Chromium layout checks at 390, 768 and 1440 px (before that merge, which touched no layout) found no horizontal overflow on the new page families.

Not verifiable from the checkout, and so still open: Search Console and Bing ownership and sitemap submission, live indexing of the new pages, citations by AI assistants, and field Core Web Vitals. The checkout has no Firestore, so the project listings and project pages were exercised with test data, and the sitemap's project URLs only on production.
