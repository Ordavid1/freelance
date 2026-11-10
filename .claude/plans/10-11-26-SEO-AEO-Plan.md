# SEO + AEO/GEO upgrade plan — Freelance Place (10-11-26)

Owner: thread "Maximize SEO and AEO" · Branch: `claude/project-thread-4a4v1p` · Production: pushes to `main` auto-deploy, so everything ships through PRs.

Status legend: `[ ]` open · `[x]` done in this branch · `[~]` partly done · `[!]` needs Or (decision, access or infra approval).

---

## 0. Ground rules for every work package

These come from the project instructions and apply to all code written for this plan.

- Root cause, general solutions, enterprise-grade. No use-case hacks, no per-keyword special cases, no patch files.
- All URL-facing code uses `absoluteUrl()` / `SITE_URL` from `src/lib/seo/site.ts` (this repo's URL-management module). Never hard-code `freelance-place.com`, `localhost` or any other origin in new code. External citation URLs inside content are fine.
- Do not touch deployment files: `deploy/*`, `infra/terraform/*`, `.github/workflows/*`, `Dockerfile`, `cloudbuild.yaml`, `scripts/deploy-engine.sh`. Propose infra changes in the plan, do not make them.
- Do not change LLM models or any AI config.
- Read the relevant guide in `node_modules/next/dist/docs/` before using a Next.js API (this is Next 16.4, not the Next you know).
- Do not use `git checkout` to revert; undo specific edits by hand. Commit only your own work. Do not push; the coordinator integrates and pushes.
- New tests go in new files, never into `tests/seo.test.mjs` (avoids merge conflicts). Existing tests must stay green.
- Honesty guardrails (these are policy, enforced by tests where possible):
  - No invented ratings, reviews, awards, statistics, customer counts, prices or "best/#1/leading" claims. No `AggregateRating`, `Review`, or `JobPosting` markup anywhere.
  - Describe only features that exist. No escrow/payment protection, no public freelancer profiles, no matching guarantees.
  - Projects published by the AI agent (`sample: true`, `owner.kind === 'ai-agent'`, `unreal: true`) are always labelled "סוכן AI" and are never presented as human client demand or as job postings.
  - Competitor facts come only from cited public pages with a check date. No affiliation implied.
  - Pricing, trial and billing statements are derived from code constants and runtime config (see WP1 `facts.ts`), never typed by hand.
- Hebrew style: mirror existing copy (`src/lib/seo/content.ts`): imperative plural for instructions ("הגדירו", "בדקו"), inclusive forms ("לקוח/ה", "איש או אשת מקצוע"), short sentences, brand written as `Freelance Place` in Latin, Hebrew maqaf in mixed text (`ל־XPlace.com`, U+05BE).

---

## 1. Audit findings (evidence)

Method: code review of `src/lib/seo/*`, routes and components; live probes of https://freelance-place.com on 2026-11-10 (headers, rendered HTML as Googlebot, GPTBot, OAI-SearchBot, PerplexityBot, ClaudeBot and a browser UA); Lighthouse 12 mobile (simulated throttling) from the sandbox; Terraform read-only.

### What is already solid (keep)
Canonical host + www 308, per-page canonical/OG/Twitter, Hebrew `lang`/`dir`, robots + sitemap + llms.txt, noindex for account/API/query variants, preview-host protection, JSON-LD escaping, Firestore-paginated sitemap, correct 404 statuses, metadata served in `<head>` for every user agent (no streaming-metadata trap today), Lighthouse SEO 100 on all probed pages, alternatives page performance 98.

### Findings, ranked

| # | Finding | Evidence | Impact | Fix |
|---|---|---|---|---|
| F1 | **Public claims contradict the product.** Home FAQ + `/alternatives/xplace` + `llms.txt` say billing is "not active / no payment details collected". Billing went live on 2026-11-09 (Cardcom, 14-day trial, ₪19.99/month). Home FAQ also says showcase projects are "not in the sitemap and not indexed" while the AI-agent projects are in the sitemap and indexable. | live HTML + `publication.ts` + memory notes | AI answers quote stale or false facts; trust and consumer-protection risk | WP1 `facts.ts` single source |
| F2 | Home HTML is an app shell: first text is "בודקים התחברות…", "טוען את מצב החברות…", personal KPIs "0 / 0 / —"; four hard-coded demo cards come before the real projects; `<h1>` is the 9th heading; project cards are `<button><h2>` with no crawlable links (only 12 links further down). | live HTML | Weak first impression for crawlers and AI fetchers; thin crawl paths | WP3 |
| F3 | Home mobile Lighthouse: performance 87, TBT 410 ms, TTI 5.0 s, 14 scripts / 333 KB, 9 API calls on load for anonymous visitors, 5 of them 401 (console errors), Firebase auth iframe + gapi (~130 KB) loaded for everyone. Other pages: 98-100. | Lighthouse JSON | INP/TBT risk, Best-practices 96 | WP3 |
| F4 | No crawlable project index: `/projects` is a 404; home links only 12 projects; no skill landing pages; category pages have one FAQ each and no inventory/skill links. | probes | Crawl depth, no long-tail landing pages | WP4 |
| F5 | Home `<title>` has no brand ("…אלטרנטיבה ל־XPlace.com") because the title template does not apply to the root segment. Project meta descriptions are cut mid-word at 135 chars. | live HTML | Brand-query CTR, snippet quality | WP1 |
| F6 | Thin entity graph: Organization has no `alternateName` (פרילנס פלייס), description, contact, language, area; no `sameAs`; no dates on WebPage/Article beyond the guide; static pages have no `lastmod`; hreflang absent. | live JSON-LD | AI/Google entity understanding | WP1 |
| F7 | AI-crawler policy is implicit (`User-agent: *`). No explicit groups, no documented policy, llms.txt is minimal and has no `llms-full.txt`. | robots.txt, llms.txt | Ambiguity for answer-engine bots; weak machine-readable summary | WP2 |
| F8 | No fast-index path for Bing/Yandex (IndexNow). ChatGPT search, Copilot and DuckDuckGo lean on Bing's index. | repo | Slow discovery of new projects | WP2 |
| F9 | Content depth: 1 guide, 4 short category pages. XPlace (main Hebrew competitor) has no guides or FAQ either, so the gap is cheap to take. No pricing, about/trust, FAQ or glossary page. | competitor fetch | Hebrew long-tail + answer-engine citations | WP5 |
| F10 | Infra: Cloud Run `min_instance_count = 0`, 512 Mi, `cpu_idle = true`; no Cloud CDN on the backend; all HTML is `private, no-store`. Lighthouse root document 590-690 ms; cold starts hit crawlers (AI bots time out in seconds). No HSTS header. HTTP→HTTPS redirect `Location` carries `:443`. | Terraform + headers | TTFB, crawl reliability | `[!]` needs approval (section 5) |
| F11 | `JobPosting` markup is not allowed for this model: Google's policy says "We don't allow job postings that require payment from applicants" and proposals need a paid membership after the 14-day trial. Seeded AI-agent projects must never be marked up as jobs. | Google Search Central job-posting guidelines | Manual-action risk | Decision: do **not** ship JobPosting. Keep `WebPage`; revisit only if applying becomes free |
| F12 | Latent scale bug: `listOpenProjects()` takes the first 100 open docs by document ID, then sorts by date. Beyond 100 open projects the feed/home would not show the newest. Fix needs a composite Firestore index (status + createdAt desc). | `src/lib/db/projects.ts` | Future | `[!]` index is infra; note only |

---

## 2. Strategy

### How AI answers pick sources (what we can influence)
- Google AI Overviews / AI Mode and Gemini ground on the Google index: page must be indexed, snippet-eligible (we already send `max-snippet:-1`), fast, and clearly answer the question. Structured data helps understanding, it is not a requirement.
- ChatGPT search relies on OpenAI's own index (OAI-SearchBot) plus partners such as Bing; Copilot and DuckDuckGo lean on Bing; Perplexity uses PerplexityBot plus third-party search; Claude uses Claude-SearchBot. Being indexed in **Google and Bing** and not blocking the named bots is the prerequisite for all of them.
- User-triggered fetchers (ChatGPT-User, Perplexity-User, Claude-User, Google-Agent…) fetch a page when a person asks about it. Fast HTML with the answer in the first screen of text is what they read.
- `llms.txt` has no proven ranking effect and Google does not use it; it is cheap, helps agent tooling, and is kept for that reason only.
- Nothing here guarantees ranking or citation. Expect: indexing in days, brand/long-tail queries in weeks, competitive Hebrew head terms in months and only with real inventory and links.

### Levers, in priority order
1. **Truth and consistency** (F1): AI engines repeat what pages say. Public facts must come from code.
2. **Indexation plumbing**: Search Console + Bing verified, sitemap submitted, IndexNow, internal linking, no soft errors.
3. **Answer-first content that earns citations**: guides and landing pages written for the question, with a direct answer first, lists/tables, dates, sources, FAQ, internal links.
4. **Programmatic pages with a quality gate**: skill/category/hub pages generated from a typed registry; a page is indexable only if it has complete original content (never doorway pages).
5. **Speed and rendering**: server-rendered answers, small JS, fast TTFB.
6. **Authority off-site** (needs Or): see section 6.

### Answer-first page template (used by every new page)
1. H1 phrased as users search it.
2. A "בקיצור" direct answer (≤ 50 words) directly under the H1.
3. Visible author (Freelance Place team) and `<time>` last-updated date that matches `dateModified`.
4. H2s phrased as questions where natural; first sentence under each H2 answers it.
5. Lists and tables for comparisons; define terms on first use.
6. Visible FAQ (3-6) with FAQPage JSON-LD using identical text.
7. Primary-source links for external facts with check dates.
8. 3-6 contextual internal links (hub, skill, guide, category).

---

## 3. Work packages

Each package lists its write-set so parallel work does not collide. Shared contracts (types) are defined in WP1 and must be implemented verbatim.

### Shared contracts (implemented in WP1, `src/lib/seo/types.ts`)

```ts
export type Question = { question: string; answer: string };
export type PageKind = 'home' | 'hub' | 'category' | 'skill' | 'guide' | 'comparison' | 'info' | 'legal';
export type SeoPage = {
  path: string;                 // starts with '/', no trailing slash except '/'
  kind: PageKind;
  title: string;                // <title> without brand suffix, 20-60 chars
  description: string;          // 70-165 chars
  published?: string;           // 'YYYY-MM-DD'
  modified?: string;            // 'YYYY-MM-DD', >= published; drives sitemap lastmod + dateModified
  indexable?: boolean;          // default true; false => noindex + excluded from sitemap/footer/llms
  llms?: { section: 'Product' | 'Guides' | 'Categories' | 'Skills' | 'Comparisons' | 'Legal'; note: string };
};
export type GuideSection = {
  id: string;                   // ASCII kebab-case anchor
  heading: string;              // H2
  answer: string;               // direct answer, 1-2 sentences, <= 320 chars
  paragraphs?: string[];
  list?: { ordered?: boolean; items: string[] };
  table?: { caption: string; columns: string[]; rows: string[][] };
};
export type Guide = {
  slug: string;                 // ASCII kebab-case -> /guides/<slug>
  title: string; description: string;
  audience: 'clients' | 'freelancers' | 'both';
  published: string; modified: string;
  summary: string;              // "בקיצור", <= 320 chars
  sections: GuideSection[];     // >= 4
  faq: Question[];              // >= 3
  related: string[];            // registry paths
  sources?: { name: string; url: string; checked: string }[];
  disclaimer?: string;
};
export type Skill = {
  slug: string;                 // ASCII -> /skills/<slug>
  name: string;                 // Hebrew display name
  aliases: string[];            // project-matching terms (case-insensitive; Hebrew + English variants)
  category: string;             // slug of a category in content.ts
  title: string; description: string;
  definition: string;           // answer-first: what it is, <= 280 chars
  whenNeeded: string;
  deliverables: string[];       // >= 4
  howToChoose: string[];        // >= 4
  priceDrivers: string[];       // >= 3, qualitative, no amounts
  questions: Question[];        // >= 3
  related: string[];            // other skill slugs
  guides?: string[];            // guide slugs
  published: string; modified: string;
};
```

### WP1 — Foundation: facts, registry, schema, metadata, accuracy
Owner: sub-thread 1 (runs first; all others branch from it).
Write-set: `src/lib/legal/identity.ts` (new), `src/components/legal-document.tsx` (re-export only), `src/lib/seo/{facts,types,registry,schema,site,content,publication}.ts`, `src/lib/seo/guides/index.ts` (empty stub), `src/lib/seo/skills.ts` (empty stub), `src/lib/seo/hubs.ts` (empty stub), `src/lib/seo/info-pages.ts` (empty stub), `src/lib/seo/profiles.ts` (empty `sameAs` list), `src/components/discovery/*`, `src/components/site-footer.tsx` + css, `src/app/layout.tsx`, `src/app/sitemap.ts`, `src/app/alternatives/xplace/page.tsx`, `src/app/guides/project-brief/page.tsx`, `src/app/categories/[slug]/page.tsx` (schema builders only), `src/app/projects/[slug]/page.tsx` (schema + description only), `src/app/llms.txt/route.ts` (truthful facts only; WP2 rewrites it), `tests/seo-foundation.test.mjs`, `docs/seo-aeo.md` (sections touched). `tests/seo.test.mjs` may be edited only where an assertion encodes behaviour this plan intentionally changes (for example static pages having no `lastmod`).
- [x] `facts.ts`: `membershipFacts()` returns price (from `PRICE_AGOROT`), trial days (from `TRIAL_MS`) and `billingAvailable` (same check as `getBillingStatus`: `cardcomConfig()` in try/catch). `contactFacts()` from `legal/identity.ts`.
- [x] Rewrite pricing/billing/AI-agent statements (home FAQ, comparison FAQ, comparison table row and payments paragraph, llms facts) from `facts.ts`; delete the false "not in the sitemap / not indexed" claim. Required copy is in section 3a.
- [x] `schema.ts`: typed builders (`organization`, `website`, `siteGraph`, `webPage`, `article`, `collectionPage`, `itemList`, `breadcrumbList`, `faqPage`, `membershipService` (emitted only when billing is available)). Organization gets `alternateName: 'פרילנס פלייס'`, description, `areaServed: IL`, `knowsLanguage: he`, `legalName` + `contactPoint` from `contactFacts()`, `sameAs` only from `profiles.ts` when non-empty. All pages use the builders. Project pages add `datePublished`/`dateModified`, `keywords` (skills) and a category breadcrumb level when the category maps to a known category.
- [x] Policy test: no `JobPosting`, `Review`, `AggregateRating`, `Rating` types in any builder output; all URLs absolute on `SITE_URL`.
- [x] `pageMetadata` v2: options `{ type: 'website' | 'article', published, modified }`, `alternates.languages` (`he-IL` and `x-default` → canonical), per-page OG image alt = title; `summarize(text, max)` that cuts at a word/sentence boundary with an ellipsis (fixes mid-word project descriptions); `viewport` export with `themeColor` in the layout.
- [x] Home title becomes `Freelance Place — פרויקטים לפרילנסרים ופרסום פרויקט בחינם` (absolute); the XPlace angle stays in the description and H2.
- [x] `registry.ts`: builds the page list from static core pages + `categories` + `guides` + `skills` (quality-gated) + `hubs` + `info-pages`; exports `allPages()`, `indexablePages()`, `pageByPath()`, `editorialPaths` (kept for compatibility); `sitemap.ts` derives from it and sets `lastModified` only where `modified` is a real date; legal pages use `legalUpdated`.
- [x] Registry invariant tests: unique paths, title/description length windows, valid dates, `modified >= published`, every `related` path resolves.
- [x] `SiteFooter` (server component) replaces `LegalFooter` in the layout: link groups for categories, skills (indexable only), guides, product pages, legal; responsive, RTL; hidden groups when empty.
- [x] `tests/helpers/load-ts.mjs` (done by the coordinator, commit e5aa82b): `loadModule(entry, { stubs, env })` resolves `@/` and relative imports, stubs packages, uses real React so components render with `renderToStaticMarkup`. `npm run test:seo` now runs every `tests/seo*.test.mjs`. Use it for all new tests.
- [x] `docs/seo-aeo.md` updated for everything above.

### WP2 — AI-crawler access, llms.txt, IndexNow
Owner: sub-thread 2 (after WP1).
Write-set: `src/lib/seo/{crawlers,llms,indexnow}.ts`, `src/lib/projects/events.ts`, `src/app/robots.ts`, `src/app/llms.txt/route.ts`, `src/app/llms-full.txt/route.ts`, `src/app/api/marketplace/projects/route.ts` (event hooks only), `public/937d6e4c8033ee12864f2c5c27fcf898.txt`, `scripts/indexnow-submit.mjs`, `package.json` (script `seo:indexnow` only), `.env.example`, `tests/seo-{crawlers,llms,indexnow}.test.mjs`.
- [x] `crawlers.ts`: typed registry of verified tokens grouped as search-index (`OAI-SearchBot`, `PerplexityBot`, `Claude-SearchBot`, `Amzn-SearchBot`, `MistralAI-Index`, `meta-webindexer`, `Applebot`, `DuckAssistBot`, `YouBot`, `bingbot`), user-triggered (`ChatGPT-User`, `Claude-User`, `Perplexity-User`, `MistralAI-User`, `meta-externalfetcher`) and training (`GPTBot`, `ClaudeBot`, `Google-Extended`, `Applebot-Extended`, `CCBot`, `meta-externalagent`, `Amazonbot`, `MistralAI-Training`, `cohere-ai`, `Bytespider`). `robots.ts` emits `*` plus explicit allow groups that **repeat** `Disallow: /api/` (a bot obeys only its most specific group). Training bots follow env `AI_TRAINING_CRAWLERS` (`allow` default, `disallow` opt-out). Preview environments stay fully disallowed.
- [x] `llms.ts` + routes: spec-style `llms.txt` (H1, blockquote summary, sections of `[name](url): note`, `## Optional`) and `llms-full.txt` (facts, FAQ, comparison summary, categories, skills, guides as markdown) generated from the registry and `facts.ts`, so they cannot drift. Both `X-Robots-Tag: noindex`, cacheable.
- [x] IndexNow: key file in `public/`, `submitIndexNow(urls)` (no-op unless indexing is enabled, own-origin URLs only, timeout, errors swallowed and logged without payloads), `events.ts` hooks called with `after()` from project create/close, `scripts/indexnow-submit.mjs` for a bulk submit from the live sitemap.
- [x] Tests for group structure, toggle, key file, payload, no-op in preview.

### WP3 — Rendering and Core Web Vitals (home and shared shell)
Owner: sub-thread 3 (after WP1; separate PR/branch if Or allows, see section 5). **Done: merged to main as PR #5 on 2026-11-10 (Deploy engine run #34 succeeded).**
Write-set: `src/app/page.tsx`, `src/components/{workspace-home,auth-control,trial-status,my-applications,studio-tools,project-proposals,actions}.tsx`, `src/lib/auth/firebase-client.ts`, `src/lib/db/projects.ts`, `src/lib/seo/projects.ts` (cache only), `src/app/{studio,workspace-responsive}.css` (order/semantics only), `next.config.ts` (headers only), tests.
- [x] One shared viewer context: `/api/auth/session` is fetched once; marketplace endpoints that need a login are called only for signed-in viewers (no 401s for anonymous visitors or crawlers).
- [x] Firebase Auth SDK, gapi and the auth iframe load on demand (sign-in intent), not on every page view.
- [x] Server passes real initial projects to `WorkspaceHome`; feed no longer flashes four demo cards then reflows; no misleading placeholder text in the SSR HTML (no "בודקים התחברות…", no zero KPIs for anonymous visitors).
- [x] DOM order: main content (H1) before the personal sidebar, visual layout unchanged; no heading inside `<button>`; each real-project card exposes a crawlable link to `/projects/<slug>`.
- [x] Heavy views (`ProfileSetup`, `StudioInbox`, `ProjectComposer`, billing, bid form, proposals) behind `next/dynamic`.
- [x] `unstable_cache` (60 s) around public project reads; HSTS (`max-age=31536000`, no includeSubDomains) via `next.config.ts` headers.
- [x] Evidence: Lighthouse mobile before/after on `/` (targets: TBT ≤ 200 ms, performance ≥ 95, zero console errors, ≤ 3 requests to `/api` for anonymous load), screenshots at 390 px and 1440 px before/after, signed-in flows exercised with Playwright request mocking.

### WP4 — Programmatic landing pages, hubs, internal linking
Owner: sub-thread 4 (after WP1).
Write-set: `src/lib/seo/{skills,hubs}.ts`, `src/lib/seo/content.ts` (category enrichment), `src/app/skills/**`, `src/app/projects/page.tsx`, `src/app/not-found.tsx`, `src/app/categories/[slug]/page.tsx`, `src/app/projects/[slug]/page.tsx` (related projects, breadcrumbs, skill links), `src/proxy.ts` (`page` param only), `src/lib/seo/related.ts`, `src/components/discovery/*` (new components only), `tests/seo-taxonomy.test.mjs`.
- [x] 20-24 curated skills across the four categories with complete original content (contract above); quality gate decides indexability.
- [x] `/skills` hub and `/skills/[slug]` pages: answer-first definition, deliverables, how to choose, price drivers (qualitative), FAQ, related skills and guides, real matching projects (if any) with links, CTA; `CollectionPage` + `ItemList` + `BreadcrumbList` + `FAQPage`.
- [x] `/projects` crawlable hub with path-free pagination (`?page=n`, self-canonical, indexable), category/skill chips as links, schema, breadcrumb.
- [x] Category pages: ≥ 3 FAQs, skill links, related guides, project counts.
- [x] Project detail: breadcrumb with category, related projects (3-6), skills link to skill pages, visible `<time>`.
- [x] Hebrew 404 page with hub links.
- [x] Tests: taxonomy invariants, matching, gate, pagination, sitemap membership.

### WP5 — Answer-first content hub
Owner: sub-thread 5 (after WP1).
Write-set: `src/lib/seo/guides/*.ts`, `src/lib/seo/info-pages.ts`, `src/components/discovery/guide-article.tsx`, `src/app/guides/page.tsx`, `src/app/guides/[slug]/page.tsx`, `src/app/{pricing,about,faq,glossary}/page.tsx`, `tests/seo-content.test.mjs`.
- [x] Guides (clients): how to hire a freelancer; how to compare freelancer quotes; freelancer or agency; what drives the cost of a website (drivers, no amounts). Guides (freelancers): pricing models (hourly, fixed, retainer); writing a proposal that gets answered; contract checklist (with "not legal advice" disclaimer). Existing `project-brief` guide stays.
- [x] `/guides` index, `/pricing` (facts-driven, `Service`/`Offer` markup only when billing is available), `/about` (who operates the service, how AI-agent projects are labelled, editorial policy, contact), `/faq` (grouped, FAQPage), `/glossary` (`DefinedTermSet`).
- [x] Content lint test: no superlatives ("הכי טוב", "מס׳ 1", "מוביל"), no guarantees ("מובטח", "100%"), no currency amounts except those from `facts.ts`, no external link without a check date, answers within length limits.

### WP6 — Backlog (not in this PR)
Per-page OG images with a bundled Hebrew font; Atom feed (`/feed.xml`) of guides + newest projects; markdown mirrors (`/<path>.md`); sitemap sharding (only needed beyond 49k URLs); English layer with real hreflang; public freelancer profile pages (privacy/consent decision first).

### 3a. Required copy (single source: `facts.ts`)
Pricing FAQ answer, billing available:
`פרסום פרויקטים חינם. פרילנסרים מקבלים 14 ימי ניסיון להגשת הצעות אחרי שמירת פרופיל שהושלם, ואחריהם אפשר להצטרף לחברות ב־₪19.99 לחודש (כולל מע״מ ככל שחל), שמתחדשת אוטומטית עד לביטול. ללא הצטרפות אין חיוב בסיום הניסיון. התנאים המלאים מופיעים בתנאי השימוש.`
Billing not available: same first two sentences, then `מחיר החברות המתוכנן הוא ₪19.99 לחודש; התשלום עדיין אינו זמין ולא מופעל חיוב.`
Numbers are interpolated from `membershipFacts()`.
"Is every project real?" answer:
`לא. חלק מהפרויקטים באתר מפורסמים על ידי סוכן AI של Freelance Place כדי להמחיש איך נראה פרויקט ברור. הם מסומנים "סוכן AI" בכל מקום שבו הם מופיעים, והצעה עליהם נשמרת בחשבון שלך ואינה נשלחת ללקוח/ה אנושי/ת. פרויקט שפורסם על ידי משתמש מוצג ללא תג זה.`

---

## 4. Verification protocol (applies before every push)

`npm run test:seo` and every new `tests/seo-*.test.mjs`, `npm run test:billing`, `npm run test:seed`, `npm run test:proposals`, `npm run typecheck`, `npm run build`, then a local `next start` crawl: rendered HTML structure, `<head>` metadata, JSON-LD parse, sitemap/robots/llms output, no hard-coded origins (`grep` for `freelance-place.com` / `localhost` in new code), Lighthouse before/after for touched templates. Local runs have no Firestore credentials: pages must degrade gracefully (empty project lists), the sitemap fails by design.

---

## 5. Needs Or

- [!] **Search Console and Bing Webmaster verification.** Needs Or's Google/Microsoft login (status 2026-11-10: Or opened Search Console; the sitemap submit and ownership check are the open step, the thread has no browser control). Steps in `docs/seo-aeo.md`. Fastest: add the Domain property in Search Console (DNS TXT), submit `https://freelance-place.com/sitemap.xml`, then in Bing Webmaster Tools use "Import from Google Search Console".
- [!] **Infra approval (Terraform PR on request):** Cloud Run `min_instance_count = 1` + `startup_cpu_boost = true` (removes cold starts for crawlers, est. low double-digit USD/month) and Cloud CDN on the backend service so anonymous HTML can be cached with `s-maxage`. Also drop `:443` from the HTTP→HTTPS redirect target.
- [!] **Firestore composite index** `projects(status ASC, createdAt DESC)` before the catalogue passes 100 open projects (F12).
- [x] **Separate branch/PR for WP3**: Or chose a separate branch and PR (2026-11-10).
- [!] `sameAs` profile URLs (LinkedIn company page etc.) once they exist; they go in `src/lib/seo/profiles.ts`.
- [!] English / hreflang layer and public freelancer profiles are product decisions (WP6).
- [!] Seeded AI-agent projects: they are indexable today (earlier decision). Recommendation: keep indexable until the planned purge date, never mark as jobs, and return 404 after purge. Reconsider `noindex` if Search Console shows thin-content or soft-404 signals.

## 6. Off-site authority playbook (cannot be done in code)
Create and fill a LinkedIn company page and add it to `sameAs`; list the product in Israeli startup directories (Startupim, Crunchbase); announce in relevant Israeli freelancer/designer/developer communities with real value (no spam); publish 1-2 original data posts once there is real inventory; ask partner sites for a link from guides they genuinely use. Track unlinked brand mentions monthly.

## 7. Measurement
- Search Console: indexed pages vs sitemap, queries, CTR, Core Web Vitals report (needs field data, 28 days).
- Bing Webmaster: index coverage, IndexNow submissions.
- Weekly AI visibility check, same prompts each time (Hebrew and English) in ChatGPT, Perplexity, Gemini/AI Overviews, Copilot, Claude: "מה האלטרנטיבות ל־XPlace?", "אתר פרילנסרים בישראל", "איפה אפשר לפרסם פרויקט לפרילנסר בחינם?", "מה זה Freelance Place?", "כמה עולה Freelance Place?", "how to hire a freelance designer in Israel". Log whether the brand is mentioned, cited and described correctly.
- Targets (p75 mobile): LCP ≤ 2.5 s, INP ≤ 200 ms, CLS ≤ 0.1. Lab: home performance ≥ 95.

## 8. Progress log
- 2026-11-10: audit complete; plan written.
- 2026-11-10: WP1 foundation merged on the thread branch (facts, schema builders, registry, pageMetadata v2, SiteFooter, honest billing/AI-agent copy). Or chose a separate branch and PR for WP3 (home performance). Content lint (`tests/seo-content.test.mjs`) and data module layout added: `src/lib/seo/skill-data/*`, `guides/<slug>.ts`, `glossary-data.ts`, `category-faq.ts`, `info-content.ts`. Skill type gained optional `sources` and `disclaimer`.
- 2026-11-10: WP3 merged to `main` as PR #5 together with the one-line fix for the broken main build (an import above `'use client'` in `workspace-home.tsx`); Deploy engine run #34 succeeded. Lighthouse mobile on a local production build (simulated throttling, median of 3): performance 93 to 95, accessibility 96 to 100, CLS 0.036 to 0, JavaScript transferred 203 KB to 157 KB, API calls on the first anonymous load 10 to 2.
- 2026-11-10: the SEO branch merged `main` (PR #5). Gates on the merged tree: `test:seo` 49 pass / 1 skipped (strict content catalogue), `test:home` 12/12, `test:billing` 31/31, `test:proposals` 3/3, `test:seed` 9/9, typecheck clean, `next build` ok, local `next start` crawl and Playwright flows pass. The sitemap returns 500 locally by design (no Firestore credentials); it is verified on production after deploy.
- 2026-11-10: content written but not yet wired to pages: skills for writing-marketing (5), design (6), video-animation (4); 25 glossary terms; four client guides; category FAQs; pricing/about/how-it-works/FAQ copy. Stub registry entries keep unfinished pages out of the footer and sitemap.
- 2026-11-10: foundation PR #6 merged to `main` (6a84157); Deploy engine run #35 succeeded and production serves the new pages: `/`, `/sitemap.xml` (200, 24 URLs, projects read from Firestore), `/robots.txt`, `/llms.txt`, `/privacy`, `/terms`, `/alternatives/xplace`, `/guides/project-brief`.
- 2026-11-10: second increment on branch `seo-increment-2` (five parallel workers, integrated by cherry-pick, verified as one tree): WP2 (crawler registry and robots groups, `llms.txt` and `llms-full.txt`, IndexNow key file, lifecycle hooks and bulk script), WP4 (23 skills and `/skills` hub, `/projects` index with `?page=n`, category and project upgrades, Hebrew 404), WP5 (eight guides, `/guides` index, `/pricing`, `/about`, `/faq`, `/how-it-works`, `/glossary`). Shared breadcrumb and date helpers unified; footer labels extended; mobile table caption fix. All work packages WP1 to WP5 are done; WP6 stays backlog.
- 2026-11-10: `main` moved while the increment was open (another chat extended the trial from 14 to 60 days, `TRIAL_MS`). The pages follow because the copy is built from `facts.ts`; the content lint now reads the allowed trial and price numbers from the code constants instead of a typed list, and the full-catalogue checks run on every `npm run test:seo` (no strict-mode switch). Gates on the merged tree: 175 SEO tests, billing 31, home 12, seed 9, proposals 3, typecheck clean, build ok, a crawl of all 53 reachable URLs clean.
