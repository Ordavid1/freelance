# Freelance Place search and answer discovery

## Implemented

The canonical origin is `https://freelance-place.com`. HTTPS requests on `www.freelance-place.com` receive a permanent 308 redirect with the original path and query preserved. The Terraform HTTP redirect sends either website hostname directly to HTTPS on the apex domain. Infrastructure changes are prepared in code and have not been applied by this chat.

The application source was imported from the repository's `app/deployment-readiness` branch. The current checkout now contains the real Next.js application, not only the earlier deployment scaffold.

### Server-rendered public pages

- `/`: product explanation, public project links, category navigation, and visible FAQs alongside the interactive workspace.
- `/alternatives/xplace`: Hebrew XPlace.com alternative comparison, selection criteria, source citation, review date, and FAQs.
- `/categories/web-development`, `/categories/design`, `/categories/writing-marketing`, `/categories/video-animation`: original field-specific guidance, related public projects, and category FAQs.
- `/guides/project-brief`: an authored, practical guide with an explicitly educational example.
- `/projects/[slug]`: project-specific metadata, canonical URL, and breadcrumbs for real published projects.

These pages use per-page titles, descriptions, canonicals, Open Graph, Twitter cards, Hebrew document language and RTL direction. The approved yellow-green logo is used in the app, public header, browser icon, Apple touch icon, and 1200 × 630 social preview. The logo has no tagline.

Root HTML renders dynamically so runtime indexing and verification settings do not get frozen into a container build. CSS, fonts, images, and Next.js rendering assets remain crawlable. Only Hebrew pages currently exist; no invented English URLs or hreflang translations are advertised.

### Indexing controls

`SITE_INDEXABLE=true` is required for production indexing. It is false in `.env.example`; Terraform sets it to true for the production service. Set false on every preview or staging deployment. Unknown hosts also receive `X-Robots-Tag: noindex, nofollow`, even if the environment is enabled. Account routes, APIs, and content-filter query variants receive the same header. Ordinary campaign parameters retain the clean page canonical without blocking indexing.

Account UI routes have HTML noindex metadata as well. They remain crawlable in robots.txt so engines can read that directive; robots.txt is not an authentication control. Existing API authorization remains responsible for protecting account data.

Demo projects are labeled and noindex. They are absent from the sitemap and public project structured data. A shared publication rule permits only open projects with nonempty titles/descriptions and public or legacy-undefined visibility. Draft, closed, private, member-only, and sample records are excluded consistently from public feed, detail lookup and sitemap.

The sitemap reads published projects in 1,000-document batches rather than reusing the UI's 100-item limit. It uses stored modification timestamps and does not invent freshness dates for static pages. Database failures fail the sitemap response instead of publishing a successful empty project list. At more than 49,000 eligible projects it fails explicitly: implement sitemap sharding before that threshold. This keeps the current single sitemap below the 50,000-URL limit. Monitor errors and latency as the catalogue grows.

### Structured data and answer engines

- Organization and WebSite identify the brand consistently.
- CollectionPage and ItemList describe public project discovery.
- BreadcrumbList describes page hierarchy.
- FAQPage uses exactly the questions and answers rendered on the page.
- Article describes the visible authored brief guide.
- Real freelance projects use WebPage, without inventing employment/job posting fields.

JSON-LD serialization escapes script delimiters and Unicode line separators. No invented ratings, reviews, awards, job salaries, live payment offers, affiliation, or superiority measurements are published. FAQ markup is semantic context; this marketplace is not promised Google's restricted FAQ rich results.

Robots rules allow search and answer-engine access to public content under the same wildcard policy. `/llms.txt` provides a small, source-linked navigation aid and current product limitations. It is supplemental: it does not create ranking privileges, compel citations, or override robots/privacy rules.

### XPlace.com positioning

Target: **XPlace.com**, with the comparison at `/alternatives/xplace`. The page answers the “best alternative” selection question, explains the product's approach, and cites `https://www.xplace.com/`, checked on 8 November 2026. The claims used from that public homepage are project/freelancer search, free project posting, and freelancer subscription plans. Competitor prices and unreviewed account functionality are not invented.

The planned ILS 19.99 membership is explicitly distinguished from an active paid offer. No automatic transfer of XPlace accounts, reviews or messages is claimed. Recheck and update the visible comparison date only after reviewing the content again.

## Configuration and launch

1. Deploy the reviewed application and infrastructure, point apex and www DNS to the load balancer, and confirm the managed TLS certificate is active. Preserve unrelated email records. No deployment or DNS mutation was performed by this SEO work.
2. Confirm `NEXT_PUBLIC_SITE_URL=https://freelance-place.com` and `SITE_INDEXABLE=true` on production. If changing the `NEXT_PUBLIC_` origin for another environment, rebuild the application; Next.js can inline public variables. All preview environments must use `SITE_INDEXABLE=false`.
3. Inspect `/robots.txt`, `/sitemap.xml`, canonical tags, redirects and response headers on the actual domain. Confirm the sitemap can read Firestore with the production runtime identity, including after private/closed status changes.
4. Verify ownership of the domain in Google Search Console and Bing Webmaster Tools. DNS verification covers apex and www; alternatively supply the exact HTML verification values as `GOOGLE_SITE_VERIFICATION` and `BING_SITE_VERIFICATION` in the runtime, then restart. The optional tokens are not fabricated or provisioned by this change.
5. Submit `https://freelance-place.com/sitemap.xml` to both consoles and inspect the home, comparison, category, guide and one real public project URL. This requires ownership access and cannot be accomplished by metadata alone.
6. Check structured data in Schema.org Validator and Google's Rich Results Test. Monitor page indexing, real search queries, canonical selection, sitemap errors and response status codes.
7. Measure mobile Core Web Vitals on production: LCP at most 2.5s, INP at most 200ms, CLS at most 0.1 at the 75th percentile. These are targets, not measured results from this change. The original workspace bundle can be split further if field measurements justify it.
8. Review comparison claims, category guidance, billing status and FAQs whenever product behavior changes. Build useful original resources and real public inventory before expanding the page count. Earn relevant editorial links; avoid manufactured reviews and duplicate doorway pages.

No code setting guarantees first place, a “best” designation in every comparison, search inclusion, or an AI citation. The implementation provides discoverable, consistent source content; rankings and citations remain external outcomes.

## Checks

- `npm run test:seo`: publication/privacy, pagination beyond 100 records, database failure behavior, preview controls, canonicals, redirects and JSON-LD escaping.
- `npm run typecheck`
- `npm run build`

A running-server check should additionally inspect rendered HTML and HTTP headers with a canonical Host header, then repeat with a preview host. Test the production domain after DNS/TLS deployment; localhost results do not establish live indexing.

### Verification in this checkout

Nine SEO regression tests, Next.js type checking, and the production build passed. Running-server checks confirmed indexable public metadata on the canonical host, noindex on account/demo pages, the www redirect, valid rendered JSON-LD, 404 handling, crawler files, the social image, and preview-host protection. A separate server using the same build confirmed runtime preview blocking and runtime verification-tag configuration.

Chromium checks at 1440px desktop and 390px mobile confirmed the comparison page layout. All comparison columns are readable as stacked rows on mobile, with no page or table horizontal overflow. The mobile home page also had no horizontal overflow and rendered one primary H1.

Terraform formatting and validation passed without applying infrastructure or accessing remote Terraform state. A missing Linux checksum for the already pinned Google Beta provider was added from HashiCorp's signed release metadata; no provider version changed.

The production Firestore-backed sitemap was tested through a mocked data boundary for publication policy, pagination, errors and URL-limit handling. It has not been verified against the live domain or production Firestore by this change.
