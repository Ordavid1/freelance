# Feature suggestions, Claude-managed backlog and user changelog

Date: 25-11-26. Status: **plan for Or's review, no code written.** Author thread: "Plan feature suggestions and changelog".

Evidence labels: **[V]** verified in the repo or tools this session, **[I]** inference or recommendation, **[U]** unverified, needs a check before build.

---

## 1. What was asked

A. A "Suggest Feature" button in the Support Chat UI that opens a free-text flow.
B. The suggestions reach Claude. Claude keeps a running backlog (artifact or sheet) and a matching thread in this project to talk about it, ordered from easy and fast to heavy and cumbersome. Or only approves a feature. After approval Claude plans, builds, opens the PR, waits a few minutes to make sure it is clean and merges, alone (updated 25-11-26; first asked for with the `/ship` plugin).
C. A changelog side panel for users, showing what was built. Its button is brand-yellow text next to the Privacy Policy and Terms of Service text buttons.

## 2. What the repo gives us today [V]

| Area | Fact | Where |
| --- | --- | --- |
| Support chat UI | One native `<dialog>` panel (modal sheet on mobile up to 760px, non-modal on desktop), welcome screen with three topic chips, composer with honeypot, footer line with a privacy link. Lazy-loaded on first open. | `src/components/support-chat.tsx`, `src/components/support-chat-panel.tsx`, `support-chat.module.css` |
| Support API | `GET/POST /api/support`, guests and signed-in users, conversation keyed by the hash of an httpOnly cookie token, idempotent message ids (client UUID), 4,000 char cap. | `src/app/api/support/route.ts`, `src/lib/support/service.ts` |
| Policy layer | Every route must be declared in the operation registry with auth, account state, per-account limit, per-address limit, site-wide budget and human check. A test fails the build if a route skips it. | `src/lib/security/operations.ts`, `policy.ts`, `rate-limit.ts` |
| Human check | reCAPTCHA Enterprise score tokens in the `x-human-token` header. Actions today: `support_message`, `ai_profile`, `ai_project_brief`. `support_message` fails closed when the provider is down. | `src/lib/security/human-check.ts`, `human-token-client.ts` |
| AI | One entry point `generateWithVertex`, model from `VERTEX_MODEL_ID` (default `gemini-3.8-flash`). Runtime kill switch `featureEnabled('ai')`, turned off automatically by the Cloud Billing budget guard. Site-wide budgets per AI feature (`globalBudgets`). | `src/lib/ai.ts`, `runtime-switch.ts`, `budget-alert.ts`, `rate-limit.ts` |
| Untrusted text in prompts | Support triage already wraps customer text in a delimiter block, strips the delimiter from the text, forces a JSON schema, validates enums and clamps lengths. Draft replies are never auto-sent. | `src/lib/support/ai-triage.ts` |
| Slack console | Outbox jobs written in the same Firestore transaction as the message, processed after the response and by a one-minute Cloud Scheduler sweep. Agents reply from Slack. | `src/lib/support/slack/outbox.ts`, `/api/support/slack/*` |
| Data | Firestore through the Admin SDK only. Client rules deny everything. Rate-limit documents use TTL on `expiresAt`. | `infra/terraform/firestore.rules`, `src/lib/db/firestore.ts` |
| PP and ToS text buttons | The workspace side panel footer: `<div className="workspace-legal-links">` with two links. The public site footer builds its legal group from the SEO registry. | `src/components/workspace-home.tsx:78`, `src/components/site-footer.tsx` |
| Brand colour | The logo chartreuse `--logo-lime: #ceef00` (bright `#e0ff2a`, deep `#9db800`) on ink `#151719`. A second yellow, `--saffron: #e8bf42`, exists in `globals.css` and is barely used. | `src/app/workspace-palette.css`, `globals.css` |
| Language | The whole site is `lang="he" dir="rtl"`. There is no i18n framework. English appears as inline `lang="en" dir="ltr"` spans. | `src/app/layout.tsx` |
| Deploy | Every push to `main` deploys to production after tests, typecheck and audit. PRs get security checks plus Claude and Codex review comments. | `.github/workflows/deploy.yml`, project memory |

### Build pipeline: this project's own flow (decided by Or, 25-11-26) [V]

Or first meant **Claude Ship** (Anthropic, launched 23 Nov 2026: the `/ship` command, Code Review, PR Steward and Claude Approvals; sources: https://claude.com/resources/articles/introducing-claude-ship, TechCrunch 23 Nov, The Register 24 Nov). It is offered on Claude Team and Enterprise plans only, and Or has no Team account. **Decision: do not use Claude Ship. The idea to production path already exists in this project and is used as is:** a thread plans, coding sub-agents build, a PR is opened, checks and review comments are read, the PR is merged, and the merge to `main` deploys.

If Or moves to a Team plan later, Claude Ship can replace steps 4 and 5 of section 6.5 without changing the gate.

## 3. Design principles

1. **User text is data, never instructions.** No suggestion text can approve, prioritise, name files to change, or reach a tool-using agent as a prompt.
2. **One source of truth per thing.** Suggestions and backlog in Firestore, changelog in the repo. Everything else is a view.
3. **Nothing builds without Or's own explicit approval** in the backlog thread.
4. **No new infrastructure.** Reuse the policy layer, the outbox and its existing one-minute sweep, the Vertex entry point and its budgets. No new Cloud Run service, scheduler job, secret or model.
5. **Generic, not feature-specific.** The domain is "product feedback" with a `kind` field, so bug reports or ideas later reuse the same intake, triage and backlog.

## 4. Architecture in one picture

```
User (chat panel)                    App (Cloud Run)                          Claude (this project)
-----------------                    ----------------                          ---------------------
"Suggest a feature"  --POST-->  feedback.suggest (policy layer)
                                 store productFeedback/{id}
                                 enqueue outbox job (same tx)
                                        |
                                 outbox: Vertex triage (budgeted)
                                 match to backlog item or new candidate
                                 Slack card to the team channel
                                        |
                                 productBacklog/{id}  <--- read/write --->  Backlog thread + scheduled sync
                                                                             effort sizing from the real code
                                                                             Backlog artifact (view, same URL)
                                                                             Or: "approve build X"
                                                                             plan, build, PR, clean check, merge  
                                        |                                                 |
                                 changelog entries (repo file) <--- added in the same PR --+
                                        |
User (workspace)  <-- "What's new" drawer next to PP and ToS
```

## 5. Part A: Suggest Feature intake

### 5.1 UI

- A fourth entry on the chat welcome screen and a persistent text button in the panel footer (next to the privacy link): **"הצעה לשיפור"**. It switches the same dialog to a suggestion view. No second dialog, no new launcher, so mobile keyboard handling and focus behaviour stay as they are.
- Suggestion view: one textarea (10 to 2,000 characters, `dir="auto"`), the existing honeypot, an optional checkbox "עדכנו אותי במייל כשזה עולה לאוויר" (shown with the email field for guests, prefilled for signed-in users), a consent line (5.5), a send button and a back link to the conversation.
- After sending: a confirmation state ("קיבלנו, תודה. אנחנו קוראים כל הצעה.") with a link to the changelog drawer. No promise of delivery or dates.
- The suggestion does **not** create a support conversation and does not appear in the chat thread, so it does not start reply polling or page a human agent.

### 5.2 API and policy

New route `POST /api/feedback` declared in `operations.ts` as `feedback.submit`:

| Setting | Value | Why |
| --- | --- | --- |
| auth | `optionalUser`, account `active` | Same audience as support chat. Suspended accounts cannot submit. |
| limit (per account) | 3 per 10 minutes, 10 per day | A person rarely has more than a few ideas a day. |
| anonymousLimit (per address) | 2 per 10 minutes, 5 per day | Guests have no account behind them. |
| humanCheck | new action `feature_feedback`, added to the fail-closed set | Anonymous free text. |
| body | raw, max 8 KB, JSON content type required | Same as support. |
| site-wide ceiling | 100 accepted suggestions per hour (env override), counted in the same transaction | Bounds storage and Slack noise if many addresses act together. |

The handler validates a client UUID (idempotent retries, same as chat messages), text length, control characters, a pathname-only `page`, and the email only when the notify box is ticked. A digest of the normalised text per author blocks resubmitting the same text.

### 5.3 Data model (Firestore, Admin SDK only)

`productFeedback/{id}` (id is the client UUID):

| Field | Notes |
| --- | --- |
| `kind` | `'feature'` now. Open for `'bug'`, `'idea'` later. |
| `text` | Raw user text. Private. Never shown outside the team. |
| `textDigest` | For exact-duplicate rejection. |
| `page`, `language` | Pathname only, detected `he` or `en`. |
| `author` | `{ uid or null, kind: 'member' | 'account' | 'guest' }`. No name. |
| `notify` | `{ optedIn, email }` only when the box was ticked. Stored apart from the text so exports and views never carry it. |
| `consent` | `{ version, at }` of the consent line shown. |
| `status` | `new`, `triaged`, `linked`, `rejected`, `spam`. |
| `triage` | Output of 6.1: category, safe summary he and en, flags, matched item, confidence, model version, time. |
| `backlogItemId` | Set when linked. |
| `createdAt`, `updatedAt`, `expiresAt` | `expiresAt` drives a Firestore TTL for the raw text (see D8). |

`productBacklog/{id}`:

| Field | Notes |
| --- | --- |
| `title`, `summary` | `{ he, en }`, written by AI and Claude, never verbatim user text. |
| `category` | Enum shared with triage (for example profile, projects, proposals, messaging, billing, search, notifications, integrations, other). |
| `status` | `candidate`, `proposed`, `approved`, `building`, `shipped`, `declined`, `parked`. |
| `effort` | `{ size: 'S' | 'M' | 'L' | 'XL', rationale, areas: [paths], estimatedBy: 'claude', at }`. |
| `demand` | `{ total, members, lastAt }`, maintained in the linking transaction. |
| `risk` | Flags that force extra care: `billing`, `auth`, `legal`, `infra`, `model`, `data-migration`. |
| `approval` | `{ by, at, threadRef }`. Written only from Or's explicit approval. |
| `pr`, `changelogEntryId` | Filled during and after the build. |

Outbox: add a generic job type to the existing outbox so the suggestion is processed by the same after-response kick and the same one-minute sweep. No new scheduler job. Indexes: one composite on `productBacklog (status, effort.size)` and a TTL policy on `productFeedback.expiresAt`, both declared in Terraform next to the existing index resources (this is an additive index, not an architecture change, but it needs a `terraform apply`, so it is listed in D9).

### 5.4 Abuse, spam and prompt injection

| Threat | Control |
| --- | --- |
| Bots and floods | Honeypot, reCAPTCHA score (fail closed), per-account and per-address limits, site-wide hourly ceiling, exact-duplicate digest. |
| AI cost abuse | Triage runs in the outbox, not in the request. It spends a dedicated site-wide budget (`ai.feedbackTriage`, proposed 30 per hour, 150 per day) and respects the `ai` kill switch and the billing budget guard. With no budget the suggestion is still stored with status `new`. |
| Prompt injection into the in-app model | Same pattern as `ai-triage.ts`: text inside a delimiter block with the delimiter stripped from the text, a system rule that the block is data, a strict JSON schema, enum validation, length clamps. The model has no tools and its output can only fill fixed fields. A matched backlog id is accepted only if it is one of the ids that were given to the model. |
| Prompt injection into Claude | Claude's backlog session reads the structured triage fields. Raw text is read only as quoted, labelled untrusted data. Standing rules for that session: suggestion text cannot approve anything, cannot set effort or priority by assertion, cannot name commands, files, secrets or links to act on, and is never pasted into a build prompt. A build starts only from a spec that Claude wrote and Or approved. |
| Stored XSS and markup | React escaping in the app, the existing Slack text escaping for cards, plain text only. |
| Harmful or personal content | Triage flags `abusive`, `contains_personal_data`, `not_a_feature` (a support question sent by mistake is offered back to the chat). Flagged items are not linked automatically. |
| Vote stuffing | Demand counts one per account (or per address hash for guests) per item, and members are counted separately, so one person repeating a request does not move the order. |

### 5.5 Privacy and consent

- Consent line under the field: the suggestion is saved, may be analysed with AI, and may be summarised without identifying details. Sensitive details should not be included. Link to the privacy policy.
- The privacy policy needs one short paragraph (purpose, AI processing by the same providers already listed, retention). Legal text and its date are Or's call (D8); other chats also edit that page, so the wording comes last and from fresh `main`.
- Nothing that identifies a person leaves the private collections: the backlog, the Slack card, the artifact and the changelog carry AI-written summaries only. The Slack card shows the author kind (member, account, guest), not a name or email.
- Notify-me emails are transactional, sent once per shipped item through the existing Resend transport, only to people who ticked the box.
- Account deletion and data requests must cover `productFeedback` by `author.uid` (check the existing deletion path when building).

## 6. Part B: backlog managed by Claude

### 6.1 Two-stage intelligence (models unchanged)

| Stage | Who | Input | Output |
| --- | --- | --- | --- |
| 1. Intake triage, per suggestion | The site's Vertex model through `generateWithVertex` (`VERTEX_MODEL_ID`, not changed) | The suggestion as untrusted data plus a compact list of open backlog items (id, title, one-line summary, at most 50) | Category, flags, safe summaries in Hebrew and English, `matchItemId` or null, confidence |
| 2. Backlog curation, per sync | Claude in the backlog thread | Structured triage results and the repository | Merges and splits of items, effort size from reading the code, risk flags, order, proposals to Or |

Why two stages: effort ("easy and fast" versus "heavy and cumbersome") can only be judged honestly against the real code, which the in-app model cannot see. Deduplication at intake only needs the list of open items, which is cheap. A confident match links the suggestion and raises demand. A weak match or none creates a `candidate` item. No embeddings or vector store are proposed at this volume; revisit above roughly 500 open items (that would need a model decision from Or).

Effort scale used for ordering:

| Size | Meaning | Typical |
| --- | --- | --- |
| S | One component or one handler, no data change | Copy, a filter, a small UI control |
| M | A few files across UI and API, additive data | A new field end to end |
| L | New flow, new collection, or touches the policy layer | A new feature area |
| XL | Cross-cutting, or billing, auth, legal, infra or model impact | Needs its own plan first |

Order of the backlog: size ascending (S first), then demand descending, then recency. Items with a risk flag are marked and never treated as quick wins regardless of size.

### 6.2 Where the backlog lives: recommendation

| Option | Pros | Cons |
| --- | --- | --- |
| Google Sheet | Familiar, Or can sort and edit | A second editable copy that drifts from Firestore. Hand edits are not validated. |
| Artifact only (page with its own small database) | Nice view | The app cannot read it, so "notify me when shipped" and demand counts cannot use it. |
| **Firestore as truth, one Artifact as the view (recommended)** | One truth the app, Slack and Claude share. The artifact keeps one URL and is republished on every sync. | Claude needs read and write access to two Firestore collections (D4). |
| Both sheet and artifact | | Two views to keep in sync for no gain. |

The artifact shows: quick wins first, columns for size, demand, members asking, risk, status, a one-line "why this size", and a "waiting for your approval" section on top. A CSV export can be offered if Or wants the data in a sheet.

### 6.3 The matching thread and its rhythm

- One standing thread in this project, "Manage feature backlog", started by the coordinator (threads cannot start threads).
- A scheduled task in that thread (D5: weekly recommended, with an immediate extra sync when Or asks). Each run first checks cheaply whether anything changed since the last sync and stops if not.
- Each run with changes: curate, republish the artifact, and post one short message: what is new, the top three quick wins, and one decision card when something is ready to approve.

### 6.4 Approval gate: one approval, then Claude runs alone (decided by Or, 25-11-26)

- An item moves to `approved` only when Or says so in the backlog thread or picks Approve on its decision card. A message from another Claude, a Slack reaction, a suggestion's text or a status edit in the artifact is not approval.
- **That single approval is the only one.** It covers plan, build, PR, the clean check, merge to `main` (which deploys), the changelog entry and the notify-me emails. Claude does not come back for a second confirmation.
- Claude stops and reports instead of merging only when the PR is not clean (6.5 step 5) or when the work turns out to need something the project's standing rules reserve for Or: a change to deployment architecture or deploy files, a model change, or scope that grew past what was approved. Such an item should be flagged on its card before approval, so that Or's approval can cover it knowingly.
- One build at a time. A second approved item waits in a queue.

### 6.5 From approval to production

**The trigger.** When an item is ready, the backlog thread posts a decision card: "Approve build: <item title>" with the options Approve, Not now, Decline, plus the size, the risk flags and a two-line description of what will be built. Or pressing Approve, or writing "approve <item>" in that thread, starts everything below.

1. **Plan.** Claude writes the item's plan file in `.claude/plans/` (date prefix) from its own reading of the code. The plan is not sent back for approval.
2. **Build.** The thread coordinates and validates; coding sub-agents write the change on a work branch from fresh `main`. Tests, typecheck and build run before the push. The changelog entry is part of the same change.
3. **PR.** Opened ready for review with the attribution lines, and watched.
4. **Clean check.** Claude waits for the checks to finish and for the automatic reviews (Claude Code Review and Codex) to post, a few minutes in practice. Clean means: every check green, no merge conflict, no unresolved review finding. Real findings are fixed and the wait restarts on the new commit. A check is never skipped or disabled to get green.
5. **Merge.** When clean, Claude merges to `main`. If it is not clean after three fix rounds, or a finding is a security issue that needs a decision, Claude stops and reports to Or instead of merging.
6. **Verify and close.** Claude watches the deploy workflow, checks the feature live, marks the item `shipped`, links the PR and changelog entry, sends the notify-me emails, updates the plan file and the artifact, deletes the work branch and reports once.

If the deploy fails or the live check fails, Claude reports at once with the rollback command (`gcloud run services update-traffic` to the previous revision) and does not roll back production without Or.

## 7. Part C: changelog for users

### 7.1 Source of truth: a typed file in the repo (recommended)

`src/lib/changelog/entries.ts`, an ordered list:

| Field | Notes |
| --- | --- |
| `id` | Stable slug, also the anchor. |
| `date` | ISO date of release. |
| `kind` | `new`, `improved`, `fixed`. |
| `title`, `body` | `{ he: string, en?: string }`. Plain text, short. |
| `link?` | Internal path to the feature. |
| `fromSuggestions?` | Boolean only. Shows a "you asked, we built" mark. No names. |

Why the repo and not Firestore: the entry ships in the same PR as the feature, so the changelog can never announce something that is not deployed; it is reviewed like code; it costs nothing at runtime; it follows the repo's pattern of single fact modules (`seo/facts.ts`). A test checks unique ids, date order, Hebrew present, and length limits. Entries for work done outside the suggestion flow are added the same way, so the changelog is complete.

### 7.2 UI

- Button: **"מה חדש"** added to `.workspace-legal-links` beside "מדיניות פרטיות" and "תנאי שימוש" in the workspace side panel. A small dot marks unseen entries (last seen id in `localStorage`, optional, wrapped in try/catch like the chat).
- Panel: a native `<dialog>` drawer that slides in from the inline-start edge on desktop and is a modal sheet on mobile, following the support chat's dialog pattern. Entries newest first, grouped by month, Hebrew by default with `dir="auto"` on text and `lang="en" dir="ltr"` on English fragments. Loaded lazily on first open. Reduced-motion respected.
- Colour honesty: chartreuse `#ceef00` as text on the light side panel has a contrast of about 1.3 to 1, far below the 4.5 to 1 accessibility minimum, so it would be nearly unreadable. Recommended: chartreuse text on a small ink (`#151719`) pill, about 13 to 1, which is still clearly "brand yellow text" and stands out next to the two plain links (D6).
- CSS gotcha from project memory: buttons inside `.personal` are reset by `studio.css`, so the new button needs a two-class selector and a visual check.
- Mobile: the side panel footer is hidden in some layouts, so the button also needs a home in the mobile panel. To be confirmed with a screenshot during build.
- Signed-out visitors (D7): optionally a `/changelog` page rendered from the same entries and linked from the public footer's legal group, registered in the SEO registry as noindex at first.

## 8. Cost controls

| Cost | Control |
| --- | --- |
| Vertex triage | One small structured call per accepted suggestion, capped by `ai.feedbackTriage` hourly and daily budgets, the `ai` kill switch and the billing budget guard. Worst case per day is the daily cap. |
| Firestore and Slack | Bounded by the intake limits and the hourly ceiling. Raw text expires by TTL. |
| Claude sync | Weekly by default, exits early when nothing changed. |
| Claude builds | Only after approval, one at a time. XL items get a plan first, not a build. |
| reCAPTCHA | One assessment per submission, same key as today. |

## 9. Phased rollout, easy first

| Phase | Scope | Size | Needs from Or |
| --- | --- | --- | --- |
| 1. Changelog | Entries file, drawer, button next to PP and ToS, tests, first entries written from the last weeks of shipped work | S | D6, D7 |
| 2. Suggest intake | Chat panel suggestion view, `feedback.submit` operation, `productFeedback`, Slack card to the team, consent line. No AI yet; Claude curates by hand from the stored items | M | D3, D8 (privacy paragraph) |
| 3. Triage and backlog | Outbox triage with the Vertex model, `productBacklog`, linking and demand counts, backlog artifact, backlog thread and scheduled sync | M to L | D4, D5, D9 |
| 4. Approve and ship | Decision cards, plan per item, build, PR, clean check, merge, changelog entry in the same PR, notify-me emails | M | Decided |
| Later, not planned now | Public roadmap or voting, bug-report kind, English UI | | |

Each phase is one PR, deployable on its own, with a kill switch (`FEEDBACK_INTAKE=off`) for the intake.

## 10. Tests and acceptance

- Policy: the route-policy test passes with the new operation; limits and the human check are covered like `support.message`.
- Intake: idempotent retry, duplicate text rejected, honeypot rejected, guest without email accepted when notify is off, suspended account denied.
- Triage: injected instructions inside a suggestion do not change category enums, cannot produce an id that was not offered, and budget exhaustion leaves the item stored as `new`.
- Changelog: entries test, drawer keyboard and screen-reader behaviour, RTL and mixed-direction text, mobile sheet, screenshot inside `.personal`.
- Privacy: no email, name or raw text in Slack cards, the artifact or the changelog.
- Full `npm test`, typecheck and build before each PR, on fresh `main`.

## 11. Decisions needed from Or

| # | Decision | Recommendation |
| --- | --- | --- |
| D1 | **Decided 25-11-26:** no Claude Ship (no Team account). Builds use this project's own flow, section 6.5. | Done |
| D2 | **Decided 25-11-26:** one approval per item covers plan, build, PR, clean check and merge to `main`. No second confirmation. | Done |
| D3 | Who may suggest: everyone including guests, or signed-in accounts only? | Everyone, with the tighter guest limits, and members counted separately in demand. |
| D4 | How Claude reaches the two Firestore collections. I could not verify that the cloud service account can read Firestore (the check was blocked) [U]. | Grant that service account access limited to these collections, or expose a scheduler-authenticated export and update endpoint. Tell me which you prefer. |
| D5 | Sync rhythm for the backlog thread. | Weekly, plus on demand. |
| D6 | Changelog button colour: chartreuse text on an ink pill, or plain chartreuse text despite the low contrast, or the saffron yellow. | Chartreuse on an ink pill. |
| D7 | Is the changelog only inside the workspace, or also a public `/changelog` page? | Workspace drawer first, public noindex page in the same phase if you want signed-out visitors to see it. |
| D8 | Privacy policy paragraph and how long raw suggestion text is kept. | 18 months for raw text, summaries kept with the backlog. Wording for your approval. |
| D9 | Phase 3 adds one Firestore index and one TTL policy through Terraform. | Approve as an additive change when we get there. |

## 12. Status

- [x] Code read: support chat UI and API, Slack console, policy layer, human check, AI entry point and budgets, footer and legal links, brand tokens, Firestore rules.
- [x] Build pipeline decided (25-11-26): project flow, single approval, autonomous merge when clean. D1 and D2 closed.
- [ ] Decisions D3 to D9.
- [ ] Phase 1 to 4 (not started; nothing is built until Or approves).
