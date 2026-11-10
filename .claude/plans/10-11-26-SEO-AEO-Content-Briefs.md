# Content briefs for WP4 (skill pages) and WP5 (guides and info pages) — 10-11-26

Companion to `10-11-26-SEO-AEO-Plan.md`. The plan's ground rules and the answer-first template apply to everything here. The briefs fix structure, intent and facts to include; the author writes the Hebrew.

## Writing rules (all content)
- Hebrew, second person plural imperative for instructions ("הגדירו", "בדקו", "בקשו"). Inclusive forms like the existing copy ("לקוח/ה", "איש או אשת מקצוע"). Short sentences, one idea per paragraph. Latin product names stay Latin (Figma, Shopify, WordPress). Mixed Hebrew/Latin uses the Hebrew maqaf `־` (`ב־Figma`).
- Answer first: the first sentence under every H1/H2 answers the question. No warm-up paragraphs, no "בעולם המודרני של היום".
- **No numbers that are not verifiable**: no prices, price ranges, rates, durations in days/weeks, percentages, market sizes or "most freelancers…" claims. Describe drivers and ask-this-question checklists instead. The only allowed figures are the membership price and trial length from `facts.ts` and the 14/19.99 values the Terms already state.
- No superlatives or guarantees: banned phrases include הכי טוב, מס׳ 1, מוביל, מובטח, מבטיחים, 100%, ללא סיכון, אחריות מלאה, "כולם", "תמיד" (except the Terms' own "פרסום פרויקטים חינם תמיד").
- No legal, tax or medical advice. Where a topic touches law (contracts, accessibility), state what the item is, give a checklist for a conversation with a professional, and link the official source. Add the page's `disclaimer`.
- Describe only features that exist (read `src/app/terms/page.tsx`, `src/app/privacy/page.tsx`, `PRODUCT_PLAN.md`, `src/components/actions.tsx`, `studio-tools.tsx`, `trial-status.tsx`). Freelance Place today: Hebrew-first project marketplace; clients post projects free; freelancers build a profile (with AI-assisted drafting from supplied materials, reviewed by the user), get a 14-day trial for submitting proposals, then membership; proposals are sent only after explicit approval; messages between the parties; saved projects; no escrow, no payment protection, no public freelancer profiles, no matching guarantee; some projects are published by an AI agent and are labelled "סוכן AI".
- External facts (anything about other companies, laws, standards) need a primary-source link and a `checked` date in `sources`. If a fact cannot be verified from an official page, leave it out.
- Brand: `Freelance Place`. Mention it where it is naturally relevant (how our flow works, our pricing), never as filler. Never imply affiliation with XPlace or any competitor, never claim to be better.
- Every answer in `faq` is 1-3 sentences and stands alone (it is quoted by answer engines without the page around it).

---

## WP4 — Skill pages (`src/lib/seo/skills.ts`)

Intent: a client searching for a freelancer for a task, or a freelancer looking for projects in a skill. Each page answers "what is X, when do I need it, what do I get, how do I choose, what drives the cost, what should I ask". Keep each page 300-450 Hebrew words of original, specific content. Completeness gate (see `skillCompleteness`): definition >= 80 chars, deliverables >= 4, howToChoose >= 4, priceDrivers >= 3, questions >= 3, >= 250 words.

Page title pattern (20-60 chars, no brand): `{שם הכישור} — פרויקטים ופרילנסרים` or a more natural phrase per skill (for example `בניית אתר וורדפרס: איך בוחרים פרילנסר`). Description 70-165 chars. H1 may differ from the title.

| slug | name | category | aliases (matching, case-insensitive) | angle and facts to include |
|---|---|---|---|---|
| wordpress | וורדפרס | web-development | WordPress, וורדפרס, WP, Elementor, אלמנטור | Fits content and brochure sites that editors update themselves; hosting, updates, plugins and security are ongoing responsibilities; theme vs custom build; Hebrew/RTL; hand over admin access and documentation |
| shopify | שופיפיי | web-development | Shopify, שופיפיי | Hosted store platform; platform subscription and app fees are paid by the store owner separately from the freelancer; theme customisation vs custom theme; Hebrew/RTL storefront; local payment, shipping and invoicing integrations must be confirmed per app; product import |
| woocommerce | ווקומרס | web-development | WooCommerce, ווקומרס | Store plugin on WordPress; ownership and control vs maintenance; hosting performance; payment gateways; plugin compatibility and updates; backups |
| webflow | Webflow | web-development | Webflow, ווב־פלואו, וובפלו | Visual builder with CMS and hosting plans; designer-built sites; limits for back-end logic; verify RTL/Hebrew in past work; export and ownership questions |
| nextjs-react | React ו־Next.js | web-development | React, ריאקט, Next.js, נקסט, TypeScript, Frontend | Custom web apps and fast sites; code ownership and repository access; testing, deployment and hosting; server rendering and SEO; documentation |
| landing-pages | דפי נחיתה | web-development | דף נחיתה, דפי נחיתה, landing page | Single-purpose conversion page; copy + design + build + tracking; forms to CRM; speed; consent and analytics setup; A/B testing needs traffic |
| website-accessibility | נגישות אתרים | web-development | נגישות, נגישות אתרים, accessibility, WCAG, a11y | Audit vs remediation; WCAG is the W3C guideline set; accessibility statement; accessibility overlays do not replace fixing code and design; legal requirements: link the official Israeli source and say requirements change, no legal advice |
| automation-integrations | אוטומציות ואינטגרציות | web-development | אוטומציה, אוטומציות, Make, Zapier, אינטגרציות, API, WhatsApp API, monday.com, CRM | Connect forms, CRM, spreadsheets and messaging; error handling and monitoring; who owns the accounts and credentials; personal-data handling in leads; documented flows |
| logo-design | עיצוב לוגו | design | לוגו, עיצוב לוגו, logo | Deliverables (vector files, colour and mono variants, usage guide); revision rounds; rights transfer and font licences; a trademark check is separate and not part of design |
| branding | מיתוג ושפה גרפית | design | מיתוג, שפה גרפית, brand identity, אסטרטגיית מותג, ספר מותג | Strategy before identity; identity system (logo, colour, type, tone, imagery); guidelines document; workshop; scope boundaries |
| ui-ux-design | עיצוב UX/UI | design | UX, UI, UX/UI, עיצוב ממשק, עיצוב מוצר, אפיון, product design | Research, flows, wireframes, UI, prototype, developer handoff; design systems; accessibility; Hebrew RTL interfaces |
| figma | Figma | design | Figma, פיגמה, Design System | File structure and components; ownership of files and seats; developer-ready specs; naming and handoff conventions |
| illustration | איור | design | איור, איורים, אילוסטרציה, Illustrator, Procreate, איור ילדים | Style fit; usage rights and licensing; print vs digital formats; book projects (page count, dimensions, bleed); source files |
| graphic-design | עיצוב גרפי | design | עיצוב גרפי, גרפיקה, Photoshop, InDesign, הכנה לדפוס, פלאיירים | Print vs digital deliverables; bleed and colour modes; source files and templates; fonts and image licences |
| copywriting | קופירייטינג | writing-marketing | קופירייטינג, קופירייטר, copywriting, כתיבה שיווקית, קופי | Persuasive copy for pages and ads; what inputs the writer needs; tone; revisions; claims must be verifiable; difference from content writing |
| content-writing | כתיבת תוכן | writing-marketing | כתיבת תוכן, בלוג, מאמרים, כתיבה טכנית, כתיבה ועריכה | Articles and blogs; research and fact checking; briefs and editorial flow; ask whether AI tools are used and who verifies facts; sources and credits |
| seo | קידום אתרים (SEO) | writing-marketing | SEO, קידום אתרים, קידום אורגני, אופטימיזציה למנועי חיפוש | Technical, on-page, content and authority work; nobody can guarantee rankings (a red flag if promised); client keeps ownership of Search Console and analytics; results take time; avoid paid link schemes |
| google-ads | Google Ads | writing-marketing | Google Ads, גוגל אדס, PPC, קמפיינים ממומנים, שיווק ביצועים, Google Analytics, GA4 | Media budget is separate from the fee; client owns the ad account; conversion tracking first; reporting; management-fee models are a cost driver (no amounts) |
| social-media-management | ניהול סושיאל | writing-marketing | ניהול סושיאל, ניהול רשתות חברתיות, Instagram, TikTok, אינסטגרם, טיקטוק, Facebook | Calendar, content creation vs community management vs paid; use platform roles instead of sharing passwords; approval flow; reporting metrics |
| video-editing | עריכת וידאו | video-animation | עריכת וידאו, עריכה, Premiere Pro, DaVinci Resolve, Reels, כתוביות | Raw footage handling; aspect ratios; Hebrew subtitles (right-to-left pitfalls); music licensing; revision rounds; delivery formats |
| motion-graphics | מושן גרפיקה | video-animation | Motion graphics, Motion design, After Effects, אנימציה, מושן | 2D animation from brand assets; storyboard, animatic, final; aspect ratios; source files; ask for Hebrew right-to-left text work in past projects |
| explainer-videos | סרטוני הסבר | video-animation | סרטון הסבר, סרטוני הסבר, Explainer video, סרטון תדמית, תסריט | Script, voice-over, visual style, length; staged approvals (script, storyboard, first cut); usage rights |
| podcast-editing | עריכת פודקאסט | video-animation | פודקאסט, עריכת אודיו, עריכת פודקאסט, מיקס, סאונד | Per-episode editing, noise reduction, loudness levelling, show notes, delivery formats and turnaround expectations |

Each page also needs: `related` (2-4 skill slugs from the same or a neighbouring category), `guides` (slugs from the WP5 list below, only guides that exist when the page is built; use the registry to filter), `published` and `modified` = 2026-11-10. `priceDrivers` are qualitative ("מספר תבניות ייחודיות", "היקף ההתאמה האישית"), never amounts.

Matching real projects to a skill: a project matches when any of its `skills` equals an alias, or when an alias of 3+ Latin characters appears as a whole word in its title; category alone never makes a match. Pages with no matching projects stay valid (original guidance); the project list shows an honest empty state and the CTA to post a project.

---

## WP5 — Guides (`src/lib/seo/guides/*.ts`)

Each guide: summary ("בקיצור", direct answer, <= 320 chars), >= 4 sections each with an `answer` (1-2 sentences) plus detail (paragraphs, list or table), >= 3 FAQ, `related` registry paths, `sources` only for external facts, `published`/`modified` = 2026-11-10. Titles 20-60 chars.

| slug | title idea | audience | outline and must-haves |
|---|---|---|---|
| hire-a-freelancer | איך שוכרים פרילנסר? שבעה צעדים מהבריף ועד המסירה | clients | Define goal and deliverables; budget and timing; write the brief (link `/guides/project-brief`); post (posting on Freelance Place is free, per the Terms); compare quotes on the same scope; check past work and ask role-specific questions; agree in writing; approve in stages; hand-over checklist; red flags |
| compare-freelancer-quotes | איך משווים הצעות מחיר מפרילנסרים? | clients | Normalise scope first; table template: included/excluded, revision rounds, timeline, post-delivery support, third-party costs, file ownership, maintenance; ask clarifying questions; red flags (vague scope, price far from the others without explanation); decision matrix |
| freelancer-or-agency | פרילנסר או סוכנות: איך מחליטים? | clients | Comparison table on criteria (scope size, coordination, continuity, specialisation, risk, cost structure) without claiming either is cheaper; when each fits; hybrid setups; questions to ask both |
| website-cost-factors | מה משפיע על המחיר של בניית אתר? | clients | Table: driver → why it matters → question to ask. Drivers: site type, unique templates, custom design vs template, content creation/migration, integrations, languages and RTL, SEO and performance, accessibility, hosting and maintenance, timeline. Recurring vs one-off costs. No amounts |
| freelance-pricing-models | איך מתמחרים פרויקט: לפי שעה, מחיר קבוע או ריטיינר? | freelancers | Each model: when it fits, risks, protections; milestones; change requests; estimating by breakdown and buffers; value-based pricing as a concept; table. No rates |
| write-a-winning-proposal | איך כותבים הצעת מחיר שמקבלת תשובה? | freelancers | Structure: goal restated, scope, approach, deliverables and timeline, price and inclusions, relevant work, questions, next step; length; mistakes (copy-paste, no questions); how a proposal is prepared and sent on Freelance Place (price, estimated time, personal note; sent only after explicit approval) |
| freelance-contract-checklist | מה כדאי שיופיע בהסכם עבודה עם פרילנסר? | both | Checklist: parties, scope, deliverables, schedule, price/VAT/payment terms, revisions and change requests, rights and licences, confidentiality, personal data, termination, liability, disputes, acceptance. Disclaimer: not legal advice. Note that the agreement is between client and freelancer and Freelance Place provides no escrow or payment protection (as in the Terms) |
| freelance-sites-israel | אתרי פרילנסרים בישראל: איך בוחרים ומה משווים? | both | Selection criteria (projects vs packaged services, language, fee model and who pays, payment handling, dispute process, supply and demand, quality signals). Neutral short descriptions of XPlace, Fiverr, Upwork and Freelancer.com **only** from their official public pages with `sources` and check dates; where Freelance Place fits and its current limits. If a platform fact cannot be verified, omit the row. Not a ranking, no "best" |

### Info pages (`src/lib/seo/info-pages.ts`, routes under `src/app/`)
- `/pricing` — H1 "כמה עולה Freelance Place?". Direct answer from `membershipAnswer(facts)`. Sections: posting is free; freelancer trial (14 days after a completed profile); membership after the trial (price, auto-renewal, cancellation as described in the Terms, link to `/terms#payments`); what membership is and is not (permission to submit proposals; not payment for work; no guarantee of work; no escrow or payment protection); FAQ. `membershipServiceNode(facts)` JSON-LD only when billing is available. Must match `terms` exactly in substance.
- `/about` — entity page: what Freelance Place is, who operates it (`contactFacts()`), independence from XPlace, how AI-agent projects are labelled, editorial policy (who writes content, how often reviewed, how corrections are handled), contact. `AboutPage` JSON-LD.
- `/how-it-works` — two flows: clients (post a project, receive proposals, message, decide) and freelancers (build a profile, 14-day trial, find projects, prepare and approve a proposal, message, membership). Only existing features. `WebPage` JSON-LD.
- `/faq` — 15-20 questions grouped (clients, freelancers, membership and pricing, trust and AI-agent projects, privacy and data). Every answer consistent with Terms and Privacy; membership answers use `facts.ts`. `FAQPage` JSON-LD with the same text.
- `/glossary` — ~20 terms (בריף, ריטיינר, אבן דרך, סבב תיקונים, היקף עבודה, קובץ מקור, זכויות שימוש, NDA, הצעת מחיר, מקדמה, חשבונית, עוסק, SLA, ועוד), each a one-sentence definition then one practical sentence. `DefinedTermSet` JSON-LD.
- `/guides` — index of all guides grouped by audience; `CollectionPage` + `ItemList`.

## Quality lint (enforced by `tests/seo-content.test.mjs`)
Scan all guide, skill and info-page text for: banned superlatives/guarantees (list above), currency amounts other than `facts.ts` values, digits followed by ימים/שבועות/חודשים/אחוז (durations and percentages), missing `checked` dates on sources, summary > 320 chars, FAQ answer > 400 chars, fewer than 3 FAQ, duplicate titles/descriptions across pages, `related` paths that do not resolve.
