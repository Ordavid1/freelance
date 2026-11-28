# MCP for Freelance Place: research and platform plan

Date: 23-11-26. Status: approved by Or on 28-11-26 ("go with the plan"); Phase 1 built and verified on 28-11-26, off by default, waiting for Or's go-ahead to merge and switch on (section 11). Author thread: "Research marketplace MCPs, design ours".

Evidence labels: **[V]** verified on a page I read this session, **[S]** secondhand (directory listing or search snippet), **[I]** inference or recommendation.

---

## 1. What the three competitors actually offer

### Upwork: official, hosted, the most complete. [V unless noted]
Source: https://www.upwork.com/ai/mcp (page "last updated November 06, 2026"), press release of 10 Aug 2026 (https://investors.upwork.com/news-releases/news-release-details/upwork-talent-now-everywhere-ai-works), PYMNTS on the 2 Nov Q3 call.

- **Transport and endpoint:** remote, hosted at `https://mcp.upwork.com/mcp`, no local install.
- **Auth:** OAuth 2.1 with dynamic client registration; the user signs in with their own Upwork account. API keys are explicitly not accepted. Connecting grants "the full set of scopes" (scopes are all-or-nothing; no scope names published). Revocation in Account Settings > Connected Apps invalidates access and refresh tokens at once.
- **Clients supported:** Claude (web, desktop, Code), ChatGPT (paid plans, Developer Mode), Cursor, Codex, any remote-MCP-with-OAuth agent. A custom agent running on a server needs Upwork to approve its callback URL, "not guaranteed", no timeline.
- **Capabilities** (the page lists features, not tool names or schemas):
  - Client role: dashboard, talent search and shortlists, draft/publish/edit jobs, invite freelancers, summarize and compare proposals, decline applicants, prepare offers, view contracts, create/edit/approve/reject milestones, timesheets, transactions, messaging, talent lists, attachments.
  - Freelancer role: dashboard with Connects balance, job search and recommendations, AI-drafted proposals, respond to invitations and offers, submit milestone work, track time, earnings, profile and portfolio edits, messaging, availability badge and boost ads.
  - Agency role: the freelancer set plus an agency-wide dashboard.
- **Safety model:** draft first, nothing sent until the user confirms. Binding money actions (send/extend offers, fund or approve milestones, accept contracts) are finished on upwork.com, not in the agent. "A person confirms every binding action", autonomous hiring is not supported. The agent "shouldn't rank, score, or pick" jobs or freelancers on its own criteria. "Upwork never has access to your chat logs."
- **Limits:** rate limits shared across all of a user's connected agents; thresholds are in a separate article I did not read (numbers **not stated**). Free to use; normal fees and Connects still apply.
- **Business signal:** the release says AI agents were already trying to log in to Upwork for users, and cites identity verification, payments and escrow as why the marketplace still matters. PYMNTS reports MCP weekly users up 20x since August and a follow-on "Upwork Now" public beta (2 Nov).
- **Gaps and complaints:** the scope model is all-or-nothing (Upwork's own FAQ says so); custom-agent callback approval is gated; ChatGPT needs Developer Mode and Medium/High reasoning; Claude Free is limited to one custom connector; Team/Enterprise need an admin to enable it. I found no Upwork-specific user complaints. OpenAI forum threads about ChatGPT connector OAuth failures are real [S, titles only] but are about the ChatGPT side in general, not Upwork.

### Fiverr: official, hosted, buyer-side search plus an AI intake agent. [V for the Claude listing, S otherwise]
Source: Claude connector directory listing "Fiverr connector for Claude", "Made by Fiverr", "Anthropic verified", added October 2026. `fiverr.com/mcp` itself could not be fetched. Help article on Mira read separately.

- **Endpoint:** `https://mcp.fiverr.com/mcp` (hosted).
- **Auth:** sign-in "not required" for browsing, evaluating talent and talking to Mira; submitting a brief "may require signing in". OAuth details not stated.
- **Seven tools:** `find_freelancers`, `get_seller_profile`, `get_seller_reviews_summary`, `list_seller_gigs`, `list_seller_reviews`, `take_brief_to_mira`, `talk_to_mira`. No schemas published. The first five look read-only [I]; `take_brief_to_mira` is the one write.
- **Boundaries:** "All payments and project checkout happen on fiverr.com, not inside this MCP." No ordering, paying or seller-side management.
- **Mira** is Fiverr's "AI headhunter" (help article, rollout gradual, web only): it builds a job description from a chat, finds matching talent, contacts them in Fiverr's inbox. Budgets under $250 are not sent to talent. The help article does not mention MCP, so how the MCP connects to Mira is **not stated**.
- **Gaps:** buyer-only, no seller tools, no consent controls described, no rate limits or pricing stated.

### Freelancer.com: official hosted MCP exists, the broadest of the three. [V from Or's screenshot of the Claude connector listing, 23 Nov 2026]
**Correction:** my first pass said no official MCP was found. That was wrong; my fetches of freelancer.com failed and I should have flagged it as unverified rather than leaning "none". Or's screenshot shows:
- Listing "Freelancer.com", developer **Freelancer Ltd**, badge **"Community"** (not the "Anthropic verified" badge Fiverr has), listed **October 2026**.
- Connector URL `https://mcp.freelancer.com/mcp` (hosted), sign-in **required**, "Can send data to mcp.freelancer.com".
- **61 tools** (only some visible). Seen: `accept_delivery`, `action_milestone_request`, `award_bid`, `award_contest_entry`, `close_project`, `create_contest`, `create_milestone`, `decline_release_request`, `edit_project`. The full list was collapsed, so the rest is **not verified**.
- Pitch: Claude writes the brief, suggests a budget, posts it for free, compares quotes (prices, ratings, reviews), answers questions and messages freelancers, awards the job, then monitors messages and deliverables and helps review the finished work. Also rehire, design contests, featuring a job.
- What this tells us: Freelancer.com lets the agent take **binding client actions** (award a bid, accept delivery, create milestones, close a project, award a contest) through MCP. Whether those are confirmation-gated, which OAuth scopes exist, rate limits and the freelancer-side tools are **not stated** in what I have. Buyer/client side is clearly the focus.
- Design implication: the field is split. Upwork keeps money-moving actions on its website; Freelancer.com puts award/accept/milestone in the tool list. We stay with the safer Upwork model (decision 3) and need not match 61 tools: our product has no escrow or milestones, so the equivalent surface is much smaller.

Earlier notes (secondary evidence):
- `developers.freelancer.com` is a JavaScript app that returned no readable text; `freelancer.com/mcp` failed to fetch.
- Community software also exists, for example `freelancer-mcp-server` by godesigntech (MIT, listed as "inactive" on Glama [S]): 21 tools including `search_projects`, `place_bid`, `send_message`, `update_profile`; auth is a personal access token the user generates on Freelancer.com, no OAuth redirect, no confirmation layer described. Useful as a warning: a token plus a `place_bid` tool is exactly the pattern to avoid.
- Official API scopes and rate limits: **not verified**.

### Take-aways for our design
0. All three competitors now ship an official hosted MCP (Upwork Aug 2026, Fiverr and Freelancer.com Oct 2026), so this is table stakes in the category, not an experiment.
1. Upwork is the benchmark on safety and it chose: hosted, OAuth, per-user, draft-then-confirm, binding actions finished on the website.
2. Their weak spots are our openings: coarse scopes, no public/anonymous tier (Fiverr has one), custom-agent gating, opaque limits.
3. Nobody publishes an Israeli/Hebrew marketplace MCP; Hebrew-first data and RTL-safe output is a differentiator [I].

Protocol baseline [V, via modelcontextprotocol.io]: the newest revision is dated 2026-07-28 and the changelog still labels it draft. It makes streamable HTTP stateless (no `Mcp-Session-Id`, no `initialize`), requires OAuth Protected Resource Metadata (RFC 9728) for authorized servers, prefers Client ID Metadata Documents over dynamic client registration (DCR deprecated), requires audience-bound tokens (RFC 8707) and gives a standard 403 `insufficient_scope` step-up. Tool annotations are untrusted hints. Recommendation: build on the official TypeScript SDK and implement whichever revisions the SDK supports on the day we start; check SDK support before Phase 1 [I].

---

## 2. What our repo gives us (and what blocks us)

Read from `Ordavid1/freelance` main (7e73b9f). Stack: Next.js 16, Firebase Auth + Firestore, Cloud Run behind a global HTTPS LB, Terraform.

**Assets**
- Public discovery already centralised: `listOpenProjects`, `getOpenProject`, `isDiscoverableProject`, `isSyntheticProject` (`src/lib/db/projects.ts`, `src/lib/seo/publication.ts`). Showcase/AI-seed projects are excluded from every SEO surface by Or's 2026-11-10 decision; MCP public tools must use the same predicate.
- Skill matching (`projectSkillMatch`, `matchesProject`), compatibility analysis for publishers (`src/lib/marketplace/compatibility-analysis.ts`), AI brief drafting (`ai.projectBrief` limit), saved mail preferences (daily/per-project alerts).
- Security primitives: per-uid transactional rate limiter (`enforceActionLimit`), account restriction check (`accountWriteDenied`), block-aware contact transaction (`assertContactAllowed`), membership gate (`requireMarketplaceAccess`), body size guard (`readJsonBody`).
- Facts single source: `src/lib/seo/facts.ts` (price, trial, billing state) feeds llms.txt; `llms.ts` and `crawlers.ts` already treat user-triggered AI fetchers as allowed.

**Blockers**
1. **Auth is cookie-only.** `getCurrentUser()` reads a Firebase session cookie and requires the Google provider; writes also require `isSameOrigin`. There is no bearer-token path, no OAuth authorization server, no concept of a third-party client. MCP needs one.
2. **Business logic lives inside route handlers.** `POST /api/marketplace/proposals`, `projects`, `conversations` embed validation, limits, membership, contact policy and Firestore transactions inline. Calling those routes from MCP would be fragile; copying the logic would let guards drift. Root-cause fix: extract a service layer (for example `src/lib/services/*`) that the REST routes and MCP tools both call. Guards then exist once.
3. **Routes return raw Firestore documents.** `GET /api/marketplace/proposals` and `conversations` spread whole documents (including `clientUid`, `freelancerUid`). MCP needs explicit output DTOs, never raw documents.
4. **No public freelancer directory exists** (public surface is projects, categories, skills, guides, headhunter minisites). So there is nothing to expose for "find freelancers" and we should not invent a PII feed.
5. **Rate limiter is per verified uid.** Anonymous public MCP traffic needs an IP/client-level limiter.
6. **`proxy.ts` and URLs.** Every path gets the CSP and canonical-host logic; `/api/*` is treated as private (noindex). MCP and `/.well-known/*` routes need explicit handling. The project's `apiUrl.ts` / `service_urls.py` do not exist in this repo; the equivalents are `absoluteUrl()` and `SITE_URL` (`src/lib/seo/site.ts`) and `publicAppOrigin()`. All MCP URLs (endpoint, issuer, resource metadata) must derive from those, never hard-coded.
7. **Terms and Privacy** (`/terms`, `/privacy`) forbid "automated use that harms the service" and mass collection of personal data, say messages are unencrypted, and say nothing about AI agents acting for a user. They need an MCP section before launch.

---

## 3. Who it serves and what is valuable

| User | Most valuable jobs for their AI assistant | Risk if done badly |
|---|---|---|
| **Freelancer** | "Which open projects match my skills this week?", explain a project and its client, draft a proposal I review, track my proposals, withdraw one | Spray-and-pray bidding, leaking profile data |
| **Publisher (client)** | Turn one sentence into a structured project brief, publish after my approval, compare incoming proposals with the compatibility summary, close the project | Publishing wrong or confidential content |
| **Headhunter / agency** | Keep minisite details current, see open vs closed counts, publish client projects | Bulk posting abuse, lookalike brands |
| **Anonymous AI assistant** (someone asking ChatGPT or Claude "where do I post a freelance job in Israel?") | Live, accurate, citable facts and open projects, with links back to freelance-place.com | Stale or hallucinated claims, showcase leaking out |

Principle (matches Upwork's FAQ and our PRODUCT_PLAN non-goals): the agent assists, the person decides. No autonomous hiring, bidding or messaging.

---

## 4. Proposed MCP surface

Names are working names; descriptions in English for model quality, returned content stays Hebrew (UTF-8, no RTL control hacks). Every tool returns a typed DTO plus a human-readable text block, and all user-generated text is labelled untrusted (see 6).

### Tier 0: public, no sign-in, read-only
Tools:
- `search_projects` (query, category, skills, budget floor, posted-within, page): open, discoverable projects only.
- `get_project` (slug): public fields, canonical URL, "apply on site" link.
- `list_categories`, `list_skills`.
- `get_platform_facts`: price, trial length, billing state, what is and is not offered (no escrow, no payments between parties). Generated from `facts.ts`, so it cannot drift from the site.
- `get_agency` / `list_agencies`: indexable headhunter minisites (name, city, open project counts; no contact data, as llms.ts already does).

Resources: `freelance-place://categories/{slug}`, `freelance-place://guides/{slug}` (reuse the existing guide data).
Prompts: `find_work_for_my_skills`, `draft_project_brief`.

### Tier 1: signed in, read-only (scopes `profile:read`, `proposals:read`, `messages:read`)
- `get_my_profile`, `get_my_membership` (state, trial end, canUseMarketplace).
- `match_projects`: open projects scored against my profile skills with plain-language reasons (reuse `projectSkillMatch`).
- `list_my_proposals`, `get_proposal`.
- `list_my_projects`, `list_project_proposals` (publisher only; includes the existing compatibility analysis).
- `list_conversations`, `get_conversation` (participants only).
- `list_saved_projects`, `get_alert_preferences`.

### Tier 2: signed in, writes, each requiring explicit confirmation
(scopes `profile:write`, `projects:write`, `proposals:write`, `messages:write`)
- `draft_project_brief` then `publish_project`. Draft uses the existing `ai.projectBrief` path and limit. Publish is a separate call.
- `draft_proposal` then `submit_proposal` (price, pricing type, delivery, message). Same rules as web: membership gate, one proposal per project, not your own project, block checks.
- `withdraw_proposal`, `close_project`, `save_project`.
- `send_message`: **only inside an existing conversation.** There is deliberately no "start a conversation" tool.
- `update_profile_fields`: returns a field-by-field diff first; never touches billing or role.

Confirmation design (recommended, see decision 3): every Tier 2 call is two-step. Step one returns a preview and a short-lived confirmation token bound to a hash of the exact payload; step two executes only with that token. The MCP elicitation mechanism asks the user to approve inside the client where supported, and the token is mandatory either way. The tool annotations (`readOnlyHint`, `destructiveHint`) are set correctly, but we never rely on clients honoring them, since the spec says annotations are untrusted. Money never moves through MCP (we do not process project payments at all, and membership checkout stays on the site).

### Tier 3: headhunter (`headhunter:manage`), later
`get_my_agency`, `update_agency_details` (re-review rules unchanged), `list_agency_projects`. Publishing on behalf of clients reuses `publish_project` with the same limits; no bulk-publish tool.

---

## 5. Auth, scopes and consent

- We need our own OAuth 2.1 authorization server, because Firebase Auth is an identity provider for our app, not an AS for third-party clients. Minimal build [I]: `/.well-known/oauth-protected-resource`, `/.well-known/oauth-authorization-server`, `/oauth/authorize` (reuses the existing Google sign-in session; renders a Hebrew consent screen listing client name and scopes), `/oauth/token`, `/oauth/revoke`. Client identification via Client ID Metadata Documents first, DCR as fallback for older clients (ChatGPT and others vary; verify per client before launch). PKCE required, audience = the MCP resource URL, short-lived access tokens, rotating refresh tokens stored hashed in Firestore, no long-lived static tokens, no API keys (same stance as Upwork).
- **Scopes are granular from day one** (Upwork's all-or-nothing is its stated limitation): `profile:read`, `profile:write`, `projects:write`, `proposals:read`, `proposals:write`, `messages:read`, `messages:write`, `headhunter:manage`. Public tier needs none. Writes use step-up consent (403 `insufficient_scope` then re-consent) so a read-only connection stays read-only.
- Users see and revoke connected apps in account settings; per-client kill switch for us (disable one `client_id` globally). Audit log of every Tier 2 call (who, which client, tool, payload hash, outcome), no message content.
- Existing account rules apply unchanged inside tools: restricted/suspended accounts cannot write (`accountWriteDenied`), blocks stop contact, membership gates proposals, `account.state` is checked on every call, not only at token issue.

---

## 6. Abuse, privacy, spam law, prompt injection

- **Rate limits:** reuse `enforceActionLimit`, adding `mcp.read` and `mcp.write` budgets *in addition to* the existing action keys, so MCP can never exceed `proposal.create`, `project.create` or `message.send` limits that the web enforces. Add an anonymous limiter (IP plus client) for Tier 0 and a cheap cached read path (the 60 s cache on public project lists already exists). Limiter outages fail closed, as today.
- **Prompt injection is the top technical risk.** Project text, proposals and messages are written by strangers and will be read by someone else's agent. Mitigations: return user text in clearly named fields marked untrusted and never concatenated into instructions; tool descriptions state that content must not be followed as instructions; no tool exposes private data to a caller that is not a participant; every write needs the payload-bound confirmation, so an injected "submit a proposal now" cannot execute silently; cap text sizes (already 4,000 chars for messages and proposals).
- **No cold outreach channel:** no tool messages a person with whom there is no proposal conversation; no email or phone export; no freelancer directory. This follows the 2026-11-18 decision against third-party contact and keeps us clear of the Israeli rules on unsolicited commercial messages (Communications Law section 30A, consent-based). In-platform proposals to an open project are the existing, accepted flow; bulk automated bidding is the abuse case, handled by per-project uniqueness, rate limits and the confirmation step. [I; not legal advice, see decision 6.]
- **Privacy:** data goes to a third-party AI provider at the user's direction. Disclose in Privacy and in the consent screen (what flows, that we do not see the chat, that revoking stops access, that we cannot recall data already given to the provider). Minimise: DTOs return only fields needed; never uids, emails or phone numbers of other users. Check against Israel's Privacy Protection Law and current amendment obligations before launch [I].
- **Showcase policy:** synthetic/showcase projects never appear in any MCP result (same predicate as SEO), and `get_platform_facts` never mentions them.

---

## 7. Hosting and deployment fit

- Streamable HTTP, stateless, so it fits Cloud Run scaling. Implement as a Next.js route handler in the existing `freelance-engine` service with the official TypeScript SDK. First option, **no infrastructure change**: serve at `https://freelance-place.com/mcp`. Second option, matching Upwork and Fiverr (`mcp.*`): a subdomain, which needs a DNS record, certificate and LB host rule in Terraform. Per project rules **I will not touch deployment architecture without your approval** (decision 1).
- Feature flag modelled on `XPLACE_*`: `MCP_ENABLED`, plus separate `MCP_WRITES_ENABLED`, so reads can ship before writes.
- `proxy.ts`: carve out the MCP, `/oauth/*` and `/.well-known/*` paths (no HTML CSP needed, `X-Robots-Tag: noindex`, no canonical redirect surprises for API clients).
- Cold start matters for tool latency: consider min-instances = 1 on Cloud Run, a cost/architecture question for decision 1.
- No new LLM calls are needed in MCP v1 beyond the existing `ai.projectBrief` path, so no model config changes. Model IDs stay untouched.

---

## 8. SEO and AEO angle

- MCP is a distribution channel, not a ranking factor. The win is being the structured, authoritative source an assistant calls when someone asks about Israeli freelance work, with every result linking back to canonical URLs (traffic and attribution).
- Add a public, indexable `/ai` (Hebrew first) page: how to connect Claude/ChatGPT/Cursor, what the tools do, what is not possible, privacy. Register it in the SEO page registry so it flows into sitemap and llms.txt, and update the llms.txt fact lines (today they say APIs are not discovery sources) to point to the MCP endpoint and `/ai`.
- Directory listings after Tier 0 is stable: Claude connector directory, ChatGPT app directory, the official MCP registry [verify current submission process at that time].
- Keep Tier 0 content consistent with SEO: same predicates, same facts module, so a comparison claim or price can never differ between the site and the MCP.
- Measure: MCP calls by tool, anonymous vs authenticated, click-throughs from MCP-provided links (UTM, as the proxy already neutralises campaign params), proposals and projects started via MCP and their conversion.

---

## 9. Phased roadmap

**Phase 0: foundations (no user-visible change).** Service-layer extraction for project reads, then proposals, projects, conversations. Output DTOs. Threat model. Terms/Privacy drafts. Anonymous limiter. Decisions 1 to 3 settled. Exit: REST routes pass existing tests with the new service layer.

**Phase 1: public read-only MCP (Tier 0).** `/mcp` behind `MCP_ENABLED`, tools and resources above, `/ai` page, llms.txt update, tests including a "showcase never leaks" test beside `tests/seo-showcase.test.mjs`. Exit: works from Claude, ChatGPT and Cursor without sign-in. **Built 28-11-26 (PR #63), off by default; the exit check runs once it is switched on in production.**

**Phase 2: OAuth plus authenticated reads (Tier 1).** Authorization server, consent screen, connected-apps page, audit log, scopes `*:read`. Exit: a freelancer sees matched projects and their proposals through their assistant; revocation works.

**Phase 3: confirmed writes (Tier 2).** Two-step confirmation with payload-bound tokens, `MCP_WRITES_ENABLED`, step-up scopes. Start with `draft_project_brief`/`publish_project` and `draft_proposal`/`submit_proposal`; then withdraw, close, send_message, profile diffs. Exit: abuse review after two weeks of limited rollout (invite-only), then general availability.

**Phase 4: headhunter tools, alerts, growth.** Headhunter scope, saved searches via MCP, directory submissions, usage dashboards, partner clients.

Execution model per project rules: this thread (Opus 5.5 high) coordinates and validates each phase plan; coding sub-threads (Sonnet 5.5 medium) implement; each chat commits only its own work; plan file updated as items complete.

---

## 10. Open decisions for Or

Recommended option first.

1. **Endpoint location.** Path `/mcp` on the main domain (no infra change) vs `mcp.freelance-place.com` (needs DNS, cert, LB rule; cleaner, like Upwork/Fiverr). Also whether to raise Cloud Run min instances.
2. **Authorization server.** Build a minimal OAuth 2.1 AS inside the app, reusing the Google sign-in (recommended: no new vendor, no new PII processor) vs adopt a managed identity vendor.
3. **Write confirmation model.** Two-step payload-bound confirmation executed in the agent (recommended, with elicitation where supported) vs Upwork's stricter model where binding actions (proposal submit, publish) finish on freelance-place.com. Middle path: ship Phase 3 with drafts-only writes (draft saved to the account, user presses the final button on the site) and add in-agent submit later.
4. **Anonymous public tier.** Yes, with the strict limiter (recommended; it is the AEO play) vs authenticated only.
5. **Which clients may connect.** Any client that supports CIMD/DCR (recommended, with our own per-client kill switch) vs an allowlist of named clients like Claude and ChatGPT.
6. **Legal.** Approve drafting the Terms/Privacy MCP section and having Israeli counsel review it, including the unsolicited-message rules and privacy law, before Phase 2 goes live.
7. **Membership interplay.** MCP reads free for everyone; writes follow the same trial/membership gates as the web (recommended) vs a promo allowance for MCP-originated proposals.
8. **Headhunters.** Include a headhunter scope in v1 or wait until the minisite programme has real accounts.
9. **Public naming and branding** of the connector (name shown on consent screens and directories).

## 11. Decisions (approved 28-11-26) and execution log

**Approval.** On 28 Nov 2026 Or wrote "go with the plan". It is read as approving the recommended option of every decision in section 10:
1. `/mcp` on freelance-place.com (no subdomain, no infrastructure change). Cloud Run min instances unchanged; revisit with real traffic.
2. Own minimal OAuth 2.1 authorization server (Phase 2).
3. Two-step, payload-bound confirmation for writes, inside the agent where the client supports it (Phase 3).
4. Anonymous public tier: yes (Phase 1).
5. Any client using CIMD or DCR, with a per-client kill switch (Phase 2).
6. Terms and Privacy MCP section drafted and reviewed by Israeli counsel before Phase 2 goes live.
7. MCP reads free; writes follow the web's trial and membership gates.
8. Headhunter tools later (Phase 4).
9. Connector name: the brand, "Freelance Place", until Or chooses otherwise.

Still needs Or's explicit go-ahead: setting `MCP_ENABLED=true` in the Cloud Run environment (Terraform, a deployment file), merging to main (main deploys to production), edge rate limiting (Cloud Armor), Cloud Run min instances.

**Phase 0, revised.** Between 23 and 28 Nov another thread merged a security programme that already delivers most of Phase 0's root fix: a transport-independent operation registry (`src/lib/security/operations.ts`, which names an MCP server as a future consumer), the HTTP adapter `route()` that every route must use, per-address limits with a trusted client-IP parser, site-wide budgets and runtime kill switches. Phase 0 therefore shrinks to what Phase 1 needs: an MCP adapter of the same registry, public response formats (DTOs) with untrusted-text sanitising, a limiter suited to high-frequency public reads, and an `mcp` kill switch. Extracting the write paths' business logic out of route handlers moves to the start of Phase 3, where its consumers exist, so production write transactions are refactored once, against real callers.

**Phase 1 design.**
- Endpoint: `POST /mcp`, stateless streamable HTTP (protocol up to 2025-11-25, the newest the official TypeScript SDK 1.32 supports; the 2026-07-28 revision is still a draft), JSON responses, no sessions. Registry operation `mcp.transport`: public, no cookies or other ambient credentials, so the same-origin check is skipped by design.
- Every tool runs under its own registry operation through `src/lib/mcp/policy.ts`, the MCP twin of `route()`: `project.list` (search_projects, get_project), `catalog.read` (categories, skills, guides, platform facts), `agency.list` (agency minisites). A tool whose operation needs a signed-in caller cannot be defined until Phase 2 adds OAuth.
- Limits: per-instance, in-memory burst limit per client address (120 per minute, 600 per 10 minutes). AI platforms call from shared egress addresses, and a Firestore counter per read would cost more than the cached read and contend on one document. Firestore budgets still apply to any operation that declares them. Total cost is bounded by the 60-second public caches and Cloud Run max instances; edge limits (Cloud Armor) are recommended before heavy traffic.
- Switch: `featureEnabled('mcp')` needs `MCP_ENABLED === 'true'` and Firestore `runtimeSwitches/mcp` not false. While off, `/mcp` answers 404 and the `/ai` page, its sitemap entry and its llms.txt line are absent.
- Data: open, discoverable projects only (showcase never), explicit DTOs, no uids, emails or bid counts, user text sanitised and labelled untrusted.
- Discoverability: `/ai` page in Hebrew, llms.txt line, robots disallow and noindex for `/mcp`.

**Status log**
- 28-11-26: plan approved; Phase 1 build started on branch `claude/project-thread-25dudp` (PR #63).
- 28-11-26: **Phase 1 built and verified, off by default.**
  - Done: burst limiter, `mcp` switch, MCP adapter (`defineTool`) and shared budget step (`budgets.ts`); read model (no uid, email, bid count or client name; untrusted text sanitised); `POST /mcp` with 8 tools (`search_projects`, `get_project`, `list_categories`, `list_skills`, `list_guides`, `get_guide`, `get_platform_facts`, `list_agencies`), resource templates for categories and guides, prompts `find_work_for_my_skills` and `draft_project_brief`; Hebrew `/ai` page; generic registry gating (`requiresFeature`) so the page, its sitemap entry, footer link and llms lines exist only while the switch is on; `/mcp` noindex, robots disallow and reserved as an agency handle (with `ai`).
  - Beyond the design: a foreign `Origin` header is refused (MCP transport rule); every refusal in front of the endpoint is a JSON-RPC error (403, 400, 413, 429); `get_platform_facts` shares `productFactLines()` with llms.txt; no e-mail address appears in any MCP output (tested); the client's display name was dropped from project results (data minimisation before the Terms and Privacy review).
  - Verified: typecheck clean, 1,124 of 1,124 tests, `npm audit` 0 vulnerabilities, production build; the official MCP SDK client against a local production build reading production data (read only): every tool, resource and prompt answers; switched off, `/mcp` and `/ai` answer 404 and nothing lists them.
  - Observed: production had no open real projects on 28-11-26, so `search_projects` returned an empty list; the catalogue, guides and facts are complete.
  - Waiting for Or: merge to main; add `MCP_ENABLED` to the Cloud Run environment in `infra/terraform/main.tf` (a deployment file) and apply it. Then run the exit check with real clients. Cloud Armor and min instances stay open until traffic justifies them.

## 12. Source list
- Upwork MCP page: https://www.upwork.com/ai/mcp
- Upwork press release (10 Aug 2026): https://investors.upwork.com/news-releases/news-release-details/upwork-talent-now-everywhere-ai-works
- PYMNTS, Upwork Q3 / Upwork Now: https://pymnts.com/earnings/2026/upwork-embeds-freelance-marketplace-inside-top-ai-tools
- Fiverr connector (Claude directory): https://claude.com/marketplace/connectors/fiverr-mcp
- Fiverr Mira help article: https://help.fiverr.com/hc/en-us/articles/48756531483537-Finding-talent-with-Mira
- Freelancer.com community MCP (Glama): https://glama.ai/mcp/servers/godesigntech/freelancer-mcp-server
- MCP spec 2026-07-28: https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization
- Repo files read: `src/lib/auth/session.ts`, `src/proxy.ts`, `src/lib/security/{rate-limit,marketplace-policy}.ts`, `src/lib/db/projects.ts`, `src/lib/membership/access.ts`, `src/app/api/marketplace/{projects,proposals,conversations,profile}/route.ts`, `src/lib/seo/{site,llms,crawlers}.ts`, `src/app/terms/page.tsx`, `PRODUCT_PLAN.md`.
