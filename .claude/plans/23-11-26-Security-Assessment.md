# Security and Privacy Assessment: Freelance Place

Date: 23-11-26. Status: findings and roadmap for Or's review. No fixes implemented, nothing changed in production.
Scope: repo `Ordavid1/freelance` at main `7e73b9f`, the live GCP project `freelance-514118` (read-only `gcloud` describes), public DNS, and one passive header read of `https://freelance-place.com`. No scanning, fuzzing, load or attack traffic was sent to any live system.
Previous audit: `docs/audits/2026-11-10-marketplace-security.md` (S01 to S12) and `docs/security-plan.md`. This report says where those items stand today.

Severity scale: **Critical** (one event leads to full compromise or mass harm), **High** (realistic attack with serious impact, or easy outage), **Medium** (real weakness, limited impact or needs a precondition), **Low** (hardening).

---

## 1. Verdict

**Application code: strong. Platform as a whole: not yet robust against a determined attacker.**

The request-handling code is well above the usual standard for a product at this stage. I read every API route and found **no IDOR, no injection, no XSS, no CSRF gap, no SSRF and no webhook forgery path**. Ownership is checked server-side on every object, Firestore client access is denied entirely, bodies are byte-capped, rate limits fail closed, billing trusts only Cardcom lookups, CSP is nonce-based with `strict-dynamic`, and `npm audit` is clean (0 vulnerabilities, all severities).

The weak points are not in the routes. They are in the control plane and the edges:

1. **One leaked agent credential is a full compromise**, including the ability to charge every stored card (Critical, F1). This was raised as S03 on 10 Nov and is still open.
2. **The site falls over under modest load.** Production can serve 20 requests at once, public pages are not cached, and only `/api/*` has an edge limit (High, F2).
3. **Anyone can send email as `@freelance-place.com`** because the domain has no DMARC record (High, F3).
4. **Cost and spam abuse scale with the number of Google accounts an attacker owns**, and the anonymous support chat can be jammed for everyone by one person (High, F4).
5. **Privacy/legal:** sign-in users are added to the mailing audience as "subscribed" without opt-in, and the Privacy page's "no behavioral advertising" statement conflicts with running Google Ads on GA4 conversions (F12, F13).

So: opportunistic attacks (bots probing for OWASP Top 10 bugs) will mostly fail. A targeted attacker would go after availability, the agent key, email spoofing, or cost, and today each of those works.

---

## 2. What is already done well (keep these)

| Control | Evidence |
| --- | --- |
| Server-only data access | `infra/terraform/firestore.rules:7` denies all client reads/writes; all access through Admin SDK in route handlers |
| Object-level authorization | Every read/write checks ownership: conversations `belongsTo` (`src/app/api/marketplace/conversations/route.ts`), proposals by `freelancerUid`/project owner, uploads by path prefix + `ownerUid`, invoices by `order.uid` (`src/lib/billing/service.ts` `invoiceUrl`) |
| CSRF | `isSameOrigin` (Origin, then Referer, exact match against the configured public origin, `src/lib/auth/session.ts:16`) on every state-changing route; SameSite=Lax HttpOnly cookies; double-submit token on session creation |
| Session creation | ID token verified with revocation check, Google provider only, `email_verified`, `auth_time` within 5 minutes (`src/app/api/auth/session/route.ts:35-39`) |
| Body limits | Streamed byte cap independent of Content-Length (`src/lib/security/request-body.ts`) |
| Rate limiting | Per-uid Firestore transactional windows, fail closed with alert (`src/lib/security/rate-limit.ts:61-66`) |
| SSRF | XPlace fetch: https only, host allowlist, manual redirects re-validated each hop, 2 MB cap, timeout, per-host throttle (`src/lib/imports/safe-fetch.ts`). Profile URLs are fetched by Vertex URL Context, not by our runtime |
| Untrusted HTML | parse5 + depth-flattening helper (`src/lib/security/html-text.ts`), hostile-input test suite |
| Billing integrity | Webhook ignores posted fields and re-queries Cardcom; amount, currency, terminal, ReturnValue, LowProfileId checked; transaction-claim docs prevent replay; deterministic renewal IDs; tokens dropped on cancel (`src/lib/billing/cardcom.ts`, `service.ts`) |
| Webhooks | Resend via Svix signature (`src/app/api/support/webhook/route.ts`); Slack v0 HMAC with 5-minute window and timing-safe compare (`src/lib/support/slack/verify.ts`); scheduler endpoints verify Google OIDC audience + exact SA email |
| Headers | Live: HSTS, nosniff, `X-Frame-Options: DENY`, `frame-ancestors 'none'`, nonce CSP with `strict-dynamic`, `script-src-attr 'none'`, `object-src 'none'`, strict referrer, `/api` no-store |
| Moderation | Moderator claim + second factor + auth within 5 minutes (`src/lib/security/moderator.ts:11`); audit events written |
| Output DTOs | Public project DTO exposes no uid/email (`src/lib/db/projects.ts:17`); Slack blocks escape mrkdwn; JSON-LD escaped |
| Prompt injection | Support triage wraps customer text in a delimiter that customers cannot close, schema-validated output, human approves every send (`src/lib/support/ai-triage.ts`) |
| Recovery | Firestore PITR, delete protection, daily backups with 30-day retention; GCS public access prevention + UBLA + soft delete on all buckets |
| CI/CD | Actions pinned by SHA, gitleaks over full history, CodeQL, `npm audit --audit-level=high` gate, keyless GitHub OIDC deploy restricted to `refs/heads/main` + push/dispatch (`infra/terraform/main.tf:176`) |
| Extension | MV3, only `storage` permission, content scripts limited to XPlace and our origin, sender tab/frame/URL checks in the worker, no network access from the extension |
| Origin isolation | Cloud Run ingress `internal-and-cloud-load-balancing`, so the run.app URL is not directly reachable |

---

## 3. Findings

### F1. Critical: the AI-agent service account is a single key to everything (S03, open since 10 Nov)

**Evidence (live, read-only):**
- `for-ai-agents@freelance-514118` holds `roles/writer` (legacy basic role, "full read and write access to most GCP resources", 12,580 permissions), `roles/secretmanager.admin`, a custom role with `run.services.setIamPolicy`, `roles/mcp.admin` and `roles/analyticshub.viewer`.
- It has **two enabled user-managed keys** (created 9 Nov 07:09Z and 15:39Z) with expiry `9999-12-31`. A key is handed to cloud agent sessions as the `GCP_SA_KEY_B64` environment variable and written to disk by `gcp-auth`.
- Cardcom card tokens and expiry dates are stored in plain fields in Firestore `billingSubscriptions/{uid}` (`src/lib/billing/service.ts`, `tx.set(subRef, { token, expiry, ... })`). The Cardcom API name and password are in Secret Manager.
- The project has **no Data Access audit logs** (`auditConfigs` absent), so secret reads and Firestore reads by this identity leave no trace.
- The default compute service account also holds `roles/editor`.

**Exploit scenario:** an agent session is prompt-injected by a web page, an email, a GitHub comment or a support message, and prints or sends its environment, or a key file leaks from any machine that ever ran `gcp-auth`. With that key an attacker reads every user's profile, messages and support history, reads the Cardcom secret, and calls `Transactions/Transaction` with any stored token to charge any subscriber's card. They can also change Cloud Run IAM, deploy their own image, and nobody would see the reads.

**Root cause:** human-grade, standing, project-wide privilege was given to a non-human identity through a static key, and the most sensitive data (payment tokens) relies only on IAM, which this identity bypasses.

**Fix (enterprise pattern):**
1. Replace keys with short-lived credentials: Workload Identity Federation or `--impersonate-service-account` from a human-approved identity, 1-hour tokens. Then disable and delete both keys. Enforce the org policy `iam.disableServiceAccountKeyCreation`.
2. Split the agent identity by job: a read-only diagnostics SA (Viewer-level, no secret access, no Firestore data read), and a separate deploy SA that already exists (`freelance-deployer`). Grant secret admin to no automated identity; Or grants it just-in-time when needed.
3. Encrypt payment tokens with Cloud KMS envelope encryption; only the runtime SA gets `cloudkms.cryptoKeyDecrypter` on that key. A Firestore dump then yields ciphertext.
4. Enable Data Access audit logs for Secret Manager, Firestore, KMS and IAM, and alert on secret access by anyone except the runtime SA, on SA key creation and on IAM policy changes (F9).
5. Remove `roles/editor` from the default compute SA.

### F2. High: availability ceiling of 20 concurrent requests with no caching layer

**Evidence:**
- Cloud Run template `autoscaling.knative.dev/maxScale: 5`, `containerConcurrency: 4` (live; `infra/terraform/main.tf:312,316`). That is **20 requests in flight for the whole site**.
- Expensive routes hold a slot for up to 60 s: `src/app/api/ai/profile/route.ts:12`, `src/app/api/integrations/xplace/project/route.ts:7`, uploads 30 s.
- Public HTML is rendered per request: the live home page returns `cache-control: private, no-cache, no-store`. The backend service has no Cloud CDN. `unstable_cache` is per instance only.
- Cloud Armor `freelance-marketplace-edge` has one throttle rule, `request.path.startsWith('/api/')`, 600/min per IP (`main.tf:572-603`, live `preview: false`). Pages, `/[handle]`, OG images and `/__/auth/*` have no limit. No preconfigured WAF rules, no Adaptive Protection, no bot management (reCAPTCHA Enterprise API is not enabled).

**Exploit scenario:** one machine opening about 40 slow concurrent connections to page URLs, or a few users running AI profile generation, fills all 20 slots and every visitor gets errors or timeouts. A small botnet spreads the load below any per-IP threshold. Requests to random `/projects/<slug>` and `/<handle>` values also force Firestore reads per request.

**Root cause:** one service mixes cheap, cacheable public reads with long, memory-heavy AI and import work, so concurrency was set low for the worst case, and nothing sits in front to absorb read traffic.

**Fix (needs Or's approval, it changes deployment architecture):**
1. Put Cloud CDN on the backend and make public pages cacheable (ISR / `s-maxage` with tag revalidation already in place), so anonymous traffic mostly never reaches Cloud Run.
2. Move AI generation and XPlace imports to a separate Cloud Run service or Cloud Tasks queue with its own concurrency and max instances; raise the web service concurrency to a normal Next.js level (for example 40 to 80) after a load test.
3. Extend Cloud Armor: per-IP rate limits for all paths (higher for pages), preconfigured OWASP rules in preview then enforce, Adaptive Protection, and rate-based ban for repeat offenders.
4. Consider `min_instance_count = 1` to remove cold-start amplification. Align the service-level `maxScale` (25) with the template value (5); today they disagree.

### F3. High: no DMARC on `freelance-place.com`, so the domain can be spoofed

**Evidence (public DNS):** `_dmarc.freelance-place.com` has no TXT record; the apex has no SPF. DKIM exists (`resend._domainkey`) and SPF exists only on `send.freelance-place.com`.

**Exploit scenario:** an attacker emails your users from `billing@freelance-place.com`, "your card failed, update it here", linking to a fake Cardcom page. Without DMARC, receiving servers have no instruction to reject it. Marketplaces are prime phishing targets because users expect payment and message emails.

**Fix:** publish `v=DMARC1; p=none; rua=mailto:<reports address>` now, review reports for 1 to 2 weeks, then move to `p=quarantine` and `p=reject`. Add `v=spf1 -all` at the apex if the apex never sends directly (Resend aligns through DKIM). DNS only, no code.

### F4. High: cost and spam abuse scale with attacker accounts, and support can be jammed

**Evidence:**
- All app limits are per uid (`src/lib/security/rate-limit.ts:10-30`). Any Google account gets the full budget: `ai.profile` 20/day with up to 24 MB of documents, 5 URLs and 16k output tokens each; `ai.projectBrief` 60/day; imports 60 to 120/day. There is no global or per-feature spend ceiling and no automatic kill switch; `AI_GENERATION_ENABLED` is manual (`src/lib/ai.ts:12`). Terraform enables the billing-budgets API but defines no budget, and the agent cannot read budgets, so I could not confirm one exists.
- Anonymous support chat: a new cookie is issued on any GET, per-conversation limits are 10 per 10 minutes, and the whole site shares **one** budget of 100 messages per hour (`src/lib/support/service.ts:75`). One person rotating cookies can use all 100 and block every real customer for the hour; each message also triggers Vertex triage and Slack posts. The only bot defense is a honeypot field.
- Restricted or suspended accounts are blocked only on projects, proposals, messages and headhunter writes. They can still use AI, uploads, imports, profile writes and OAuth connections (see F5).

**Exploit scenario:** a script with 50 throwaway Google accounts burns 1,000 AI profile generations a day at maximum size; or one person keeps the support channel saturated during a launch.

**Fix:** a global cost limiter per feature (token bucket in cost units, shared across all users) on top of the per-uid limits; a billing budget with a Pub/Sub action that flips `AI_GENERATION_ENABLED`; reCAPTCHA Enterprise (or Turnstile) on anonymous support and before the first AI call of a new account; per-IP plus per-device budgets for anonymous endpoints; replace the single global support budget with per-IP and per-fingerprint budgets plus a higher global cap; account-age or trust tiers for expensive features.

### F5. Medium (structural): security policy is opt-in per route

**Evidence:** each handler calls its own mix of `isSameOrigin`, `getCurrentUser`, `enforceActionLimit`, `accountWriteDenied` and `requireMarketplaceAccess`. `accountWriteDenied` appears in 5 route files only. Missing account-state checks on `/api/ai/*`, `/api/uploads/profile-source`, `/api/marketplace/profile` PUT, `/api/integrations/*`, `/api/marketplace/saved-projects`, `/api/marketplace/mail-preferences`. `/api/marketplace/profile` PUT has no rate limit and accepts 2.1 MB bodies.

**Why it matters:** today ownership is correct everywhere, but every new route is one forgotten call away from a gap, and the MCP plan (`plans/23-11-26-MCP-Platform.md`, section 3 item 2) adds a second entry point to the same logic.

**Fix:** extract the service layer the MCP plan already proposes, and give every operation a declarative policy (auth required, origin check, account state, action limit, body cap, membership). Add a test that enumerates every `route.ts` and fails if an exported mutating handler has no policy. This fixes F4's suspended-account gap at the root.

### F6. Medium: Identity Platform configuration is wider than the app

**Evidence (live and `main.tf:273-275`):** email/password sign-in is **enabled**, though the app accepts only `google.com` sessions; `localhost` is an authorized domain in production; project MFA state is `DISABLED`, so the moderator API (which requires a second factor) cannot be used and moderation happens by direct database writes outside the app's audit trail. Browser API key restrictions could not be verified (API Keys API disabled).

**Exploit scenario:** anyone with the public web API key can create email/password users through the Identity Toolkit REST API, inflating the user base and triggering Firebase verification emails to arbitrary addresses from your project.

**Fix:** disable the email provider in Terraform, remove `localhost`, enable TOTP MFA for moderator accounts so the existing moderation API works, restrict the browser key to the site referrer and the Identity Toolkit / Secure Token APIs.

### F7. Medium: production changes are not gated by review

**Evidence:** every push to `main` deploys (`.github/workflows/deploy.yml:3-4`). Per project memory, agent threads commit and merge to `main`, and PR-only checks (CodeQL, gitleaks) do not block a direct push. Branch protection settings were not verified in this review.

**Exploit scenario:** a prompt-injected agent, or a stolen GitHub token, ships code straight to production.

**Fix:** branch protection on `main` (required status checks, required review by Or, no direct pushes), and a GitHub `production` environment with required reviewer on the deploy job.

### F8. Medium: session lifecycle

**Evidence:** logout only clears the cookie (`src/app/api/auth/session/route.ts:76-85`); it does not revoke refresh tokens, so a stolen `fz_session` stays valid for up to 5 days. Restricting or suspending an account does not revoke sessions. The cookie has no `__Host-` prefix.

**Fix:** revoke on logout and on suspension (`revokeRefreshTokens`; `verifySessionCookie(..., true)` is already used, so revocation takes effect immediately), rename to `__Host-fz_session`, and consider a server-side session record for idle timeout and per-device logout.

### F9. Medium: detection gaps

**Evidence:** existing alerts cover renewal failures, limiter outage, upload cleanup and 5xx rate (`infra/terraform/security-monitoring.tf`). Not covered: IAM policy changes, SA key creation, secret access, Cloud Armor 429 surges, sign-in anomalies, AI spend spikes. Data Access logs are off (F1). Log retention is 30 days.

**Fix:** log-based alerts for the events above, Data Access logs on sensitive services, a log sink with longer retention for security events, and turn on Security Command Center findings (the API is already enabled).

### F10. Medium: support auto-reply can be used to send attacker text from your domain

**Evidence:** `src/lib/support/autoreply.ts:102` echoes the inbound Subject (up to 200 chars) into the reply from `customer@freelance-place.com`; replies go to the From address after header checks, capped at 3 per sender per day and 200 per hour site-wide (`:23`). A spoofed From at a domain without DMARC passes the auth-results check.

**Exploit scenario:** 200 emails an hour to victims, carrying the attacker's subject line, sent by your domain, which damages your sending reputation and can carry spam or phishing text.

**Fix:** use a fixed subject, reply only when `Authentication-Results` shows an aligned DKIM or SPF pass, and lower the site-wide cap. Also check `Authentication-Results` in the agent-reply bridge (`src/lib/support/service.ts:140`), which trusts the From header (mitigated today by the 128-bit reply token).

### F11. Medium: Nango runs production OAuth connections in its `dev` environment

**Evidence:** `deploy/README.md:34` and `docs/nango-social-profile.md:7`: the live key selects Nango `dev`.

**Fix:** create the Nango `prod` environment, move the GitHub and LinkedIn integrations, rotate the key, then point the Cloud Run secret at it.

### F12. High (legal risk): mailing audience opt-out instead of opt-in

**Evidence:** every Google sign-in is mirrored to the Resend "General" segment (`src/lib/audience/signin-sync.ts`, called from `src/app/api/auth/session/route.ts:47`) with `RESEND_AUDIENCE_NEW_CONTACTS=subscribed` (live env). Existing users were backfilled. The Privacy page itself says sign-in is not consent to advertising.

**Risk:** any promotional broadcast to that segment is an advertisement sent without prior consent under the Communications Law section 30A, which allows statutory damages per message without proof of harm.

**Fix:** create contacts as unsubscribed; add an explicit, unticked opt-in with a stored consent record (time, wording version, source); send marketing only to opted-in contacts; keep service emails separate.

### F13. Medium (privacy accuracy): advertising and analytics vs the Privacy page

**Evidence:** the Privacy page states "אין בשירות מנגנון פרסום התנהגותי" while Google Ads campaigns run and the GA4 `sign_up` event is planned as an Ads conversion. GA loads with no consent screen (stated on the page). The ad-features beacon is currently blocked only by accident (CSP, see memory note on `stats.g.doubleclick.net`). The page also describes email/password sign-in and password reset, which the app does not offer.

**Fix:** decide the advertising stance. Either keep Google signals and ad personalisation off in GA4 and say so, or add Consent Mode v2 with a consent banner and update the page. Remove the password wording, or remove the password provider (F6) and keep the page aligned.

### F14. Medium (compliance): Amendment 13 and the Data Security Regulations

**Evidence:** the system holds profiles, private messages, support conversations, payment tokens and documents for an Israeli user base. There is no documented data inventory or retention schedule (the Privacy page says no automatic deletion), no access logging (F1/F9), no self-service deletion or export, and no incident procedure mapped to notifying the Privacy Protection Authority.

**Risk:** under the Privacy Protection Law as amended by Amendment 13 (in force since August 2025) and the 2017 Data Security Regulations, a database like this likely needs a security procedure, access logging, periodic risk review and incident reporting. This is my reading, not legal advice; confirm with Israeli privacy counsel.

**Fix:** a compliance pack (database definition document, security procedure, risk assessment, incident runbook with authority notification), a retention schedule per collection enforced by Firestore TTL, and an account deletion and export workflow that also covers Storage, Resend, Nango and Cardcom (keeping accounting records under legal hold).

### Low findings

| ID | Finding | Evidence | Fix |
| --- | --- | --- | --- |
| L1 | Profile `website`, `logo`, `avatar` stored unvalidated, up to 2 MB data URLs including SVG. Rendered only to the owner today in `<img>` (safe), but a stored-XSS and open-redirect risk once a public profile directory ships | `src/app/api/marketplace/profile/route.ts:12,41` | Validate at write: https URLs only, re-encode images server-side, store images in GCS, not Firestore |
| L2 | CSP keeps `style-src 'unsafe-inline'` and `img-src https:` (a data-exfiltration channel if HTML injection ever appears) | `src/lib/security/csp.ts:11-12` | Narrow `img-src` to known hosts; move to nonce'd styles when feasible |
| L3 | HSTS without `includeSubDomains`/`preload` | `next.config.ts:9` | Intentional; revisit once every subdomain is HTTPS-only |
| L4 | When a user has no name, the public project card shows their email local-part | `src/app/api/marketplace/projects/route.ts:57` | Use a neutral label instead; disclosed in the Privacy page today |
| L5 | Card tokens and PII have no app-level encryption and Firestore uses Google-managed keys | see F1 | KMS envelope encryption for tokens (F1 item 3) |
| L6 | Agent replies from Slack go to whatever email the anonymous visitor typed | `src/lib/support/service.ts` | Human-in-the-loop today; show "unverified email" in the Slack card |

### Previous audit items (10 Nov): status today

| Item | Status |
| --- | --- |
| S01 abuse/spend budget | Partly done: per-uid limits and edge rule exist. Global ceiling and Sybil resistance missing (F4) |
| S02 recovery | Done: PITR, backups, delete protection. Restore drill not evidenced |
| S03 agent credentials | **Open**, now with `roles/writer` as well (F1) |
| S04 trust and safety | Mostly done: blocks, restrictions, appeals, moderator role. Moderator MFA unusable (F6), restriction not universal (F5) |
| S05 billing alerting | Partly done: renewal-failure alert exists; daily reconciliation not evidenced |
| S07 body limits | Done |
| S08 headers/cache | Done |
| S10 privacy lifecycle | Open (F14) |
| S11 AI/URL controls | Acceptable; URL fetch stays with Vertex |
| S12 dependencies | Done: 0 advisories today |

---

## 4. Hardening roadmap

Each phase is ordered by risk reduced per hour of work. Items marked **[Or]** are console, DNS or account actions only Or can take or approve. Items marked **[arch]** change deployment architecture and need Or's go first, per project rules.

### Phase 0: this week (mostly configuration, no app code)
1. **[Or]** F1: create short-lived access for agents, then disable and delete both `for-ai-agents` keys; remove `roles/writer` and `roles/secretmanager.admin` from it; remove `roles/editor` from the default compute SA.
2. **[Or]** F3: publish DMARC `p=none` with reports; plan the move to `reject`.
3. F1/F9: enable Data Access audit logs (Secret Manager, Firestore, IAM, KMS) and add alerts for SA key creation, IAM changes and secret access, in Terraform.
4. F6: disable the email/password provider and remove `localhost` (Terraform); **[Or]** enable TOTP MFA for the moderator account.
5. **[Or]** F7: branch protection on `main` and a `production` environment reviewer.
6. F12: switch `resend_audience_new_contacts` to unsubscribed; hold marketing broadcasts until opt-in exists.
7. **[Or]** F4: billing budget alert on the project.

### Phase 1: one to two weeks (application code)
1. F5: service layer with declarative per-operation policy, plus the route-coverage test. Shared with MCP Phase 1, so build it once.
2. F4: global per-feature cost limiter, budget-to-kill-switch automation, reCAPTCHA Enterprise on anonymous support and first AI use, per-IP limits for anonymous endpoints.
3. F1: KMS envelope encryption for Cardcom tokens, with a one-time migration of existing tokens.
4. F8: revoke sessions on logout and suspension; `__Host-` cookie.
5. F10: fixed auto-reply subject, require aligned authentication, lower cap; auth check in the reply bridge.
6. L1: server-side validation of profile URLs and images.

### Phase 2: two to four weeks (infrastructure, [arch])
1. F2: Cloud CDN plus cacheable public pages; split AI/import work into its own service or queue; raise web concurrency after a load test in a staging project (never against production); Cloud Armor all-path limits, OWASP rules (preview first), Adaptive Protection.
2. F11: Nango `prod` environment.
3. F9: security log sink with longer retention; Security Command Center review.

### Phase 3: in parallel (privacy and legal)
1. F14: compliance pack with counsel; retention schedule with Firestore TTL; deletion and export workflow.
2. F13: advertising/consent decision, then Privacy page update (remove password wording, analytics and ads truth).
3. F12: opt-in UI with consent records.

Before the MCP platform ships, Phases 0 and 1 should be complete: MCP adds a public, programmatic entry point that multiplies F2, F4 and F5.

---

## 5. Method and limits

- Read every route under `src/app/api`, the security, auth, billing, support, import and integration libraries, `src/proxy.ts`, `next.config.ts`, Terraform, the workflows, the extension manifest, bridge and worker, and the Privacy page.
- Live read-only checks: Cloud Run service description and IAM, project IAM, SA key list (metadata only), Cloud Armor policy, bucket settings, Firestore database settings, Identity Platform config, one `HEAD` request to the home page and one to `/api/config/firebase`, public DNS via DNS-over-HTTPS.
- `npm audit` on the lockfile (production and full).
- Not done: penetration testing, load testing, dynamic scanning, real payment flows, Chrome Web Store package review, GitHub branch-protection settings, billing budgets (no permission), API key restrictions (API disabled), legal review.

## 6. Execution log
- 23-11-26: assessment written. No items executed yet.
