# P2P marketplace security implementation plan

Date: 10 November 2026. Based on the [source and infrastructure audit](audits/2026-11-10-marketplace-security.md). Timings below are planning estimates and depend on staffing, designated test accounts and provider access. Owners are responsibilities, not assigned people.

## Intended security outcome

A client and a freelancer can discover one another, exchange a private proposal and continue a conversation without exposing another account's data. They can report abuse, stop unwanted contact and understand what the platform has actually verified. Membership charges are consented, repeatable without duplicate debits, cancellable and reconcilable. Operators can detect problems, restrict an abusive account, preserve evidence and restore service/data.

Keep membership payments separate from project money. Until project payments are designed, product/support language must not imply escrow, insured delivery, protected payouts or dispute adjudication over funds the platform does not control.

## Phase 0 — Restore access and establish a recoverable release (day 1–3)

| Work | Owner | Completion evidence |
| --- | --- | --- |
| Fix Google flag/provider mismatch (S06) | App + cloud owner | Existing enabled provider retained; production Google flag explicitly true; designated test account completes login/callback/session/logout; expired and revoked sessions rejected |
| Review and release the prepared code (S01/S07–S09) | App engineer | PR tests/typecheck/build pass; dependency gate reviewed; immutable digest recorded; two-user staging smoke passes; rollback digest available |
| Apply recovery/client-rule/TLS definitions (S02/S09) | Cloud owner | Reviewed production plan preserves existing resources, runtime vars and secret versions; live PITR enabled, daily backup schedule active, client rules deny all; TLS smoke passes |
| Restore test | Cloud + finance owner | Backup/PITR restored into an isolated database; representative ownership relationships and billing claims reconcile; written restore duration and recovery point |
| Add actionable monitoring (S05) | Operations owner | On-call destination configured and tested for 5xx/latency, renewal failures, aged pending orders, scheduler failure, denied/failed quota checks, uptime and spend thresholds |
| Start privileged-key migration (S03) | Cloud/security owner | Each active key consumer identified; short-lived replacement demonstrated; least-privilege target documented; no key disabled before replacement works |

Provisional recovery targets: **RPO ≤1 hour, RTO ≤4 hours**, to be confirmed by a restore drill. PITR generally provides a short recovery window and needs time after enablement to accumulate history; daily backups add a longer 30-day retained history. These are targets, not achieved guarantees. Do not use an environment-wide production rollback to undo financial transactions; reconcile gateway outcomes against restored records first.

### Concrete release order

1. Capture the active revision/digest, traffic, runtime settings and secret references as sanitized metadata. Maintain a complete production variable set; the defaults are not production values. In particular, `engine_image=null` makes existing conditional edge/Cloud Run resources disappear from a Terraform plan.
2. Review the source diff and the actual infrastructure plan. Prepared changes include a new rules API/ruleset/release, quota TTL field, backups/PITR, SSL policy and edge policy. Resolve import/drift issues and expect **no removal of existing production services or data**. No Terraform plan was generated in this audit.
3. Configure approved alert destinations and logging retention/access. Account for PITR/backups, Cloud Armor, TTL deletions and load-balancer logging costs. Avoid copying callback query strings into chat, tickets or long-retention debug logs.
4. Apply reviewed infrastructure. Deploy the tested application by resolved image digest. Existing Admin SDK permissions support quotas; TTL is cleanup rather than a prerequisite for the quota decision. Verify client rules cannot read or write profiles, billing, membership or quota documents.
5. Enable the Google UI flag in the preserved production variable set, then complete designated-account sign-in and cross-account checks. Do not change OAuth secrets or switch authentication methods as an incidental workaround.
6. Verify real headers/status codes at the public origin, direct-origin isolation, source upload/delete, project/proposal visibility and conversation ownership. Exercise billing only with provider-designated test facilities; no real charge is needed for deployment validation.
7. Observe edge preview and app quota outcomes. For app rollback, restore the previous image digest/traffic while keeping newly created backups. Do not remove recovery resources or loosen client rules to roll back unrelated app behavior.

## Phase 1 — Trust and safety for peer interactions (week 1–2)

| Work | Owner | Acceptance criteria |
| --- | --- | --- |
| Report flow for project/profile/message/account | App + trust/safety | Signed-in reporter references a visible target, selects a reason and gets a case ID; rate limits and deduplication; no public exposure of reporter identity |
| Block relationship | App engineer | Either peer can stop new contact; proposal creation and message writes check the block in the same transaction as the write; UI reflects restrictions; prior evidence is retained under policy |
| Account/content restrictions | App + trust/safety | Explicit `active`, `restricted`, `suspended` account policy and content `pending`, `published`, `hidden`, `removed` states; authorization enforced centrally and on affected writes; public caches/search hooks invalidated on takedown |
| Moderator tooling | App + security owner | Separate moderator role; MFA and recent reauthentication; scoped case access; no client-supplied role elevation; every case view/action has actor, reason, target and timestamp |
| Appeals and evidence | Trust/safety + privacy owner | Published triage priority/SLA, evidence access rules, reporter updates and appeal path; sensitive evidence excluded from general logs and exports of unrelated parties |
| Anti-scam controls | App + trust/safety | Detect repeat near-identical listings/proposals, suspicious links and off-platform payment bait; human review path; conservative thresholds and false-positive review |

Suggested initial schema:

- `accountSecurity/{uid}`: restriction state, reason code, effective time, version, reviewer; server writes only. Membership state must never confer moderation privileges.
- `userBlocks/{deterministicPairKey}`: blocker/blocked identities and timestamp; checks in both contact directions. Define whether blocked users may still view public listings; do not imply public pages become private automatically.
- `abuseReports/{id}` and `moderationCases/{id}`: reporter, subject type/ID, reason, evidence pointer, workflow state and assigned team. Keep report creation separate from privileged case resolution.
- `securityAuditEvents/{id}` or a dedicated restricted audit sink: actor, action, subject reference, outcome, correlation ID, time and policy version. Redact message bodies, OAuth credentials and payment tokens. Restrict writes and route privileged events to a separately protected retention destination.

Suggested case states: `new → triaged → investigating → actioned/dismissed → appealed → resolved`. Preserve the original report and append action events; do not overwrite the evidence history with the latest status.

An account restriction should stop harmful marketplace writes while leaving legitimate cancellation, billing-history access, appeals and privacy requests possible. Emergency Firebase disable/revocation remains an incident tool for account takeover; design its customer-support consequences explicitly.

## Phase 2 — Financial operations, privacy and resilience (week 2–4)

| Work | Owner | Acceptance criteria |
| --- | --- | --- |
| Daily payment reconciliation | Finance + app | Gateway and internal ledger compared by terminal/transaction/cycle/amount/currency; duplicate, missing, refunded and uncertain outcomes enter an owned exception queue |
| Pending-renewal recovery | App + operations | Bounded retries with backoff and stable gateway IDs; aged work cannot starve the queue; cancellation races and unknown outcomes tested; manual resolution never double-charges |
| Support/refund operations | Finance + security | Authorized operator, recent auth, written reason, immutable event; processor success reconciled before access/financial state changes; no browser-supplied “paid” authority |
| Retention/export/deletion | Privacy + app | Policy per collection/provider; authenticated export and deletion request; idempotent background cleanup; defined billing/legal holds; deletion receipt distinguishes active removal from backup/provider expiry |
| Upload lifecycle | App engineer | Quarantine/scanning before peer delivery; owner-bound access; orphan/reservation cleanup; generation-aware deletion; storage-size limits verified under concurrent uploads |
| AI controls | App + security | Global spend alerts/kill switch; provider/model token budgets; prompt-injection cases; imported evidence resolved server-side; no AI/OAuth data presented as verified professional credentials |
| Edge enforcement and capacity | Cloud + app | Preview reviewed for at least one representative traffic period; office/mobile shared-IP, OAuth and Cardcom callback behavior tested; enable `edge_rate_limit_preview=false`; load-test AI memory/concurrency separately |
| Supply chain and environments | Security + cloud | Branch protection requires checks/review; CodeQL and secret scanning; historical secret review; image scanning/provenance; isolated staging and billing test configuration; compatible dependency remediation |
| Credential retirement | Cloud/security | Short-lived agent federation operational; two current agent keys retired after dependency verification; project-wide secret-management access removed or narrowly replaced; credential-use monitoring |

The prepared account quotas are an initial layer. Add anonymous IP/network budgets at the edge, credential/session abuse controls, signed-in OAuth/billing/read budgets, and account-cluster signals. Do not trust caller-supplied forwarding headers as an identity or quota key. IP throttles alone punish shared networks and do not solve account farming.

For profile URL ingestion, preserve the current provider boundary until a direct-fetch design is tested. A future first-party fetcher must reject private/link-local/metadata destinations after DNS resolution, validate every redirect, cap response bytes/time/types, and run with restricted egress. Client-supplied social excerpts remain self-reported content until matched to a server-held import.

## Separate milestone — Decide the project transaction model

Before implementing platform project payments, product/finance/legal must choose:

1. Direct peer payment with a clearly limited marketplace/support role, or provider-managed marketplace payments with identified buyer/seller obligations.
2. Contract acceptance, delivery/milestone states, fees/currency/tax handling, cancellation/refund rules and evidence requirements.
3. Seller onboarding/verification, payout-account change protections, reserves, chargebacks, fraud review, payout holds and dispute authority appropriate to the chosen provider and jurisdiction.

If money moves on-platform, use a provider designed for marketplace funds flows, an auditable financial ledger, idempotent server-owned state transitions and reconciliation. Define separate authorization for accepting an offer, releasing funds, changing a payout destination and resolving a dispute. Do not extend membership-token storage into a home-built escrow system.

Reputation also needs a transaction model: allow reviews only from an eligible completed interaction, prevent self-dealing and duplicate reviews, show dispute/removal policy and keep the difference between self-reported skills, identity checks and completed-work evidence clear.

## Release acceptance matrix

Use anonymous, project-owner, freelancer, unrelated-account and scoped-moderator test identities. Test both API behavior and UI consequences, including revoked/expired sessions and suspended accounts.

| Area | Required negative and recovery cases |
| --- | --- |
| Session | CSRF mismatch, forged origin/forwarding headers, malformed/oversized body, non-Google token, stale auth, expired/revoked/disabled account |
| Proposals | Other owner's listing, self-proposal, duplicate/replayed submission, closed project, blocked peer, expired membership, strict price/type/ID handling |
| Messages | Guessed conversation ID, unrelated account read/write, block/suspension during send, quota-store failure, burst/concurrent writes |
| Public content | Private/draft/removed records excluded from API, details, sitemap and caches; takedown invalidation verified; no email/UID/token leakage |
| Sources | Foreign UID/source ID, guessed object path, malformed multipart, UTF-8 byte cap, forged length, concurrent quotas, interrupted upload, deletion of retained generations |
| Billing | Forged/replayed callback, ownership mismatch, terminal/amount/currency mismatch, duplicate transaction ID, timeout before/after debit, lease expiry, cancel/update-card race, refund/reconciliation discrepancy |
| Operations | Failed backup/restore, secret rotation, missing quota store, AI provider outage, scheduler delay, edge false positive, rolled-back application with forward data changes |
| Moderation | Unprivileged elevation, missing MFA/recent auth, out-of-scope case, retaliatory reports, evidence retention, audit-event failure, appeals |

Use the Firestore emulator to verify real transaction retries and client rules; current unit doubles validate the application contract but cannot certify emulator/provider behavior. Use Cardcom-approved sandbox fixtures and designated test accounts for processor and end-to-end checks. Record artifacts without credentials, customer content or reusable access links.

## Operating dashboard and completion standard

Track successful/failed sign-ins, 401/403/429/503 trends, AI requests/tokens/spend, quota-store errors, report backlog/age, block/suspension actions, billing failures/aged pending orders, reconciliation exceptions, backup freshness and restore-drill age. Assign each alert a responding owner and a tested action; dashboards alone are insufficient.

Completion requires deployed and verified controls, named operational owners, tested alerts and a recorded restore/reconciliation drill. Passing source tests or applying Terraform alone does not establish marketplace readiness. The audit's prepared changes are the starting implementation; the open acceptance work above remains the delivery backlog.
