# P2P marketplace security audit

Inspected 10 November 2026, approximately 08:42–09:05 UTC. Source baseline: `8887fed`, branch `work`. Production metadata observed revision `freelance-engine-00037-2vj`, referencing image tag `05df6362ad60f51530d34eba6eb09d73e0aa1eca`; that commit is not present in this checkout. Source conclusions therefore describe this checkout; public HTTP and cloud metadata conclusions describe the observed deployment.

## Assessment

**Risk is high for unrestricted marketplace growth.** There is a useful authentication and authorization foundation, but recovery, abuse prevention, operational detection and marketplace safety are incomplete. This review found configuration gaps and missing controls; it did not establish a cross-account data breach or a successful payment bypass.

The current product connects clients and freelancers and charges for membership. It does not implement project-fund custody, escrow, payouts or a delivery-dispute ledger. Security work should protect those existing relationships and membership charges now. Project-payment guarantees require a separately specified financial model.

Application hardening and infrastructure definitions were improved in this checkout. **Nothing from this audit was deployed, applied to GCP, merged or pushed.** Infrastructure improvements below remain prepared changes. See the [implementation plan](../security-plan.md) for priorities, ownership and acceptance criteria.

## Scope and method

- Read application routes, session handling, marketplace persistence, membership policy, Cardcom integration, profile-source storage, OAuth/AI boundaries, deployment scripts, GitHub workflows and Terraform.
- Used authenticated, read-only GCP resource/configuration/IAM metadata requests against `freelance-514118`. IAM `getIamPolicy` used its read-only POST operation. No customer documents, messages, invoices, stored files or Secret Manager payloads were retrieved. No payment, renewal, account creation or production mutation was initiated.
- Checked the public home/sign-in pages, anonymous conversation access and direct Cloud Run URL. Tested the built application locally and used controlled database/provider doubles for security regressions.
- Ran dependency advisory checks, the existing test suite, new regression tests, type checking, production build, Python tests, Terraform formatting/validation and local HTTP checks.
- This is a source/configuration assessment, not a full penetration test. Live two-user flows, provider sandboxes, Firestore-emulator contention/rules tests, restoration and incident drills remain release acceptance work. No exhaustive historical secret scan, organization-wide IAM review, DNS registrar audit or compliance certification is claimed.

## Architecture and trust boundaries

| Boundary | Current implementation | Main security obligation |
| --- | --- | --- |
| Browser → edge → Next.js | Global HTTPS load balancer, serverless NEG, Cloud Run | TLS, request limits, abuse filtering, safe caching; prevent origin bypass |
| Browser → Identity Platform → app session | Firebase tokens exchanged for five-day HttpOnly cookies | Recent verified Google login, CSRF/origin protection, revocation checks |
| Next.js → Firestore/Storage | Admin SDK under a dedicated runtime service account | Every route must authorize its actor; client rules do not constrain Admin SDK |
| Client ↔ freelancer | Projects, proposals and participant conversations | Prevent enumeration, unsolicited contact, harassment, fraud and private-content leakage |
| App → Cardcom | Hosted card collection, server-side verification, deterministic renewal IDs | Protect payment tokens, consent, cancellation, idempotency and financial reconciliation |
| App → OAuth providers / Nango | User-bound authorization and import | Check connection ownership; minimize scopes and token retention |
| App → Vertex AI | Stored owner documents, public URL context, imported excerpts | Limit spend and data volume; treat content as untrusted; avoid invented verification claims |
| GitHub → build → deployment | OIDC workload federation, builder/deployer/runtime accounts | Restrict who can release, test before credentials, deploy immutable image bytes |

### Minimum data-access contract

| Entity | Public | Owner / sender | Other participant | Unrelated account |
| --- | --- | --- | --- | --- |
| Published project | Only explicitly public fields | Manage own state | Read public fields | Read public fields |
| Proposal | None | Sender reads/withdraws own proposal | Project owner reads proposals for their project | None |
| Conversation/message | None | Participant reads/sends | Other named participant reads/sends | None |
| Profile sources / imports | None | Own account only | None | None |
| Membership / billing history | None | Sanitized own status and invoices | None | None |
| Billing token / quota records | None | Server operations only | None | None |
| Future moderation case | None | Reporter receives limited case status | No automatic access to reporter identity | None; scoped moderator access must be audited |

The existing routes generally respect these boundaries. Conversation regressions now verify that a stranger cannot read messages or write to a participant thread. Existing proposal, withdrawal, OAuth ownership and billing tests cover additional boundaries. Exhaustive live authorization verification is still outstanding.

## Observed production state

These observations supersede the older deployment notes; they are a point-in-time snapshot.

| Control | Live evidence | Assessment |
| --- | --- | --- |
| Canonical HTTPS | Home returned 200; apex and `www` managed certificate ACTIVE | Working at inspection |
| Origin isolation | Cloud Run ingress `INTERNAL_LOAD_BALANCER`; direct `run.app` returned 404 | Useful protection; public `run.invoker` is intentional behind restricted ingress |
| Runtime identity | `freelance-runtime`; datastore access and a custom session role | Separated from deployer/builder; runtime still accesses all application collections |
| Scaling | Maximum five instances; 512 MiB; concurrency 80; timeout 300 s | Caps instance count, but large AI inputs need memory/concurrency load testing |
| Private buckets | Upload and Terraform-state buckets enforce uniform access and public-access prevention; both versioned | No public bucket access observed; legacy project-level viewer/editor grants merit review |
| Upload retention | Noncurrent versions have seven-day lifecycle deletion; soft delete also seven days | Removing an active source does not immediately purge all retained copies |
| Firestore recovery | Deletion protection on; PITR disabled; zero backup schedules | Deletion protection cannot undo damaging updates/deletes |
| Edge abuse controls | Backend had no `securityPolicy`; CDN disabled | No attached Cloud Armor policy observed |
| Monitoring | Monitoring API returned zero alert policies | No project alert policies observed; external monitoring was not assessed |
| Membership billing | `BILLING_ENABLED=true`; OIDC renewal scheduler enabled every 15 minutes | Treat as real financial operations, despite older “billing unavailable” notes |
| Sign-in | Google provider enabled, runtime `GOOGLE_SIGN_IN_ENABLED=false`; public page says unavailable and has no password form | Live sign-in configuration conflicts with Google-only application policy |
| Automation credentials | Two enabled user-managed keys on agent SA; project `secretmanager.admin` grant | Broad credential blast radius; runtime, deployer and builder each had zero user-managed keys |
| Client database rules | Rules API returned no releases; repository had no managed Firestore rules | Client policy was not codified; this is not proof of public database access |

## Findings and disposition

Severity expresses practical business impact here, not a formal CVSS score. “Prepared” never means fixed in production.

### S01 — High: authenticated abuse and resource spend have no shared budget

**Evidence:** baseline AI, project, proposal, messaging and upload POST routes authenticated the user but had no time-based action quotas. Origin checks stop browser CSRF, not a malicious account scripting requests. Five Cloud Run instances do not cap AI charges, Firestore operations or account farming.

**Prepared:** `src/lib/security/rate-limit.ts` adds transactional, shared per-account limits before body processing/downstream calls on six costly writes. Failures return 503; exhaustion returns 429 with `Retry-After`. One hashed document per account/action avoids document growth per request. Terraform prepares TTL cleanup.

**Remaining:** anonymous/session/billing/OAuth/read-endpoint budgets, distributed account abuse, global AI spend alarms and emergency switches, and large-input load tests. Fixed windows permit bursts at their boundaries; these initial limits are not a fraud-detection system. Cloud Armor is prepared in preview only.

### S02 — High: no durable recovery beyond deletion protection

**Evidence:** live PITR disabled and no Firestore backup schedules. The app contains billing consent, order state, memberships and private conversations that cannot be reconstructed from container images.

**Prepared:** enable Firestore PITR and daily backups with 30-day retention in `infra/terraform/main.tf`.

**Remaining:** apply the reviewed configuration, verify actual recovery windows as they accumulate, restore into a separate database, reconcile payment history, and document recovery ownership/RPO/RTO. These settings add cost and do not protect other providers' data.

### S03 — High: long-lived privileged agent credentials

**Evidence:** live agent account has two enabled user-managed keys and project-level `roles/secretmanager.admin`, plus other grants. Metadata alone does not establish compromise. GitHub workload federation is already available, and the application identities are keyless.

**Action:** migrate the agent to short-lived federation, inventory consumers, reduce permissions to named resources, rotate and retire keys only after validating replacement access. Review project-derived storage object grants and human access to private files/state. No IAM grants or keys were changed during this audit.

### S04 — High: marketplace trust and safety is still an operating gap

**Evidence:** no report/block/case-management endpoints or app-level suspension policy exist. `getCurrentUser` checks Firebase validity/revocation but not a marketplace moderation state. Projects publish immediately. A participant can keep sending messages while the relationship exists. Terms offer an email contact; that does not supply a triage or enforcement workflow.

**Action:** implement reporting, blocking, suspension/restriction states, content takedown, moderator RBAC/MFA, audit trails, appeals and evidence-preservation rules. Preserve access to billing cancellation and necessary records when restricting marketplace activity. Move these controls ahead of growth features.

### S05 — High: live financial operations lack demonstrated reconciliation and alerting

**Evidence:** billing and the scheduler are enabled; no GCP alert policies exist. `src/lib/billing/service.ts` has careful transaction claims, leases, deterministic IDs and cancellation handling, but this audit did not verify actual processor outcomes, refunds or support procedures. `renew/route.ts` processes bounded due/pending sets without a demonstrated aged-failure queue or escalation process.

**Positive:** callbacks ignore posted payment fields and fetch the saved order result from Cardcom; ownership, amount/currency/terminal checks and duplicate protection exist. The suite exercises replay, cancellation and unknown network outcomes.

**Action:** add daily processor-ledger reconciliation, aged-pending alerts/dead-letter handling, charge/refund support controls, renewal-failure alerts and an incident runbook. Rate-limit confirmations and unsigned webhooks without relying on callback content for authenticity. No real transaction was made to validate this integration.

### S06 — High availability issue: sign-in flag conflicts with the accepted provider

**Evidence:** live Google provider is enabled; live UI flag is false and `/signin` explicitly reports unavailable. `src/lib/auth/session.ts` and the session route accept Google sessions only. Existing sessions can continue, but the inspected UI does not offer a working new sign-in path.

**Action:** preserve the configured provider and explicitly enable the Google UI flag in the production variable set. Verify login, callback, new session, expiry and logout using a designated test account. Avoid restoring password login accidentally as a workaround. Defaults were not silently changed for other environments.

### S07 — Medium: body limits trusted caller-supplied lengths

**Evidence:** most baseline handlers checked `Content-Length` and then buffered JSON/multipart; several mutations had no limit. The billing helper checked string length only after reading the whole body. The session route could also dereference a parsed `null` body.

**Prepared:** all JSON/form parsing in the API now uses byte-bounded streaming readers. Missing/understated lengths cannot bypass the cap; invalid UTF-8/non-object JSON returns 400. AI profile requests now cap multipart metadata at 256 KiB because documents are loaded from private storage rather than uploaded directly to that endpoint. Document paths and pricing-type coercion in proposal inputs were tightened.

**Remaining:** ingress/proxy buffering and slow-client protections are separate controls. The app limiter cannot eliminate resource use that occurs before a route runs.

### S08 — Medium: incomplete browser and cache hardening

**Evidence:** baseline `next.config.ts` set HSTS only; some authenticated error responses lacked explicit no-store headers.

**Prepared:** frame denial, `nosniff`, referrer/permissions policies, a limited CSP (`frame-ancestors`, `object-src`, `base-uri`), and private/no-store on API responses. Local production HTTP checks verified these on successful and 401 responses.

**Remaining:** a tested script-source CSP compatible with Next rendering, Firebase, Nango and OAuth. The limited CSP does **not** provide full script-injection prevention. No COOP setting was imposed without popup testing.

### S09 — Medium: release and client-database guardrails were incomplete

**Evidence:** deployment previously built without running the test suite/typecheck; Actions used mutable major tags, and the release script passed an image tag to Cloud Run. Firestore rules were not managed in the source.

**Prepared:** full tests/typecheck/Python checks and high/critical production dependency gate before cloud authentication; read-only PR/scheduled checks; verified upstream Actions commit pins; Dependabot; digest-resolved releases with rejection of invalid digests; explicit deny-all Firestore client rules. The Cardcom diagnostic workflow now tests IAM permission instead of fetching secret payloads.

**Remaining:** branch-protection/ruleset enforcement, CodeQL/secret scanning and historical scanning, image scanning/provenance/admission checks, preview/staging isolation and approved rollback artifacts. Branch protections and org policies were not inspected. Deny-all rules do not restrict Admin SDK access.

### S10 — Medium: privacy lifecycle and upload safety need completion

**Evidence:** uploads have ownership checks, type/magic/UTF-8 checks and quotas, but no quarantine/AV workflow; crash-interrupted `uploading` reservations have no cleanup job. Account deletion/export remains a manual email process. Storage versioning/soft delete retain old generations beyond active-file deletion.

**Action:** define retention by collection/provider, build authenticated export/deletion requests, reconcile sources and orphaned objects, support billing/legal holds, and test purging generations. Add scanning/quarantine before allowing documents to be shared/downloaded by peers. This review found no executable-file delivery or established PDF code-execution vulnerability.

### S11 — Medium: AI evidence and URL controls must not become trust badges

**Evidence:** profile generation accepts client-supplied social excerpts; valid JSON/citations do not prove provider ownership or factual truth. `safePublicUrl` rejects obvious internal/literal addresses but is lexical; it does not verify DNS or redirect destinations. URL retrieval is delegated to Vertex URL Context, not an application-side URL fetch, so an exploitable runtime SSRF was not established.

**Action:** retain server-generated provenance for imported sources, distinguish self-description from verified identity/credentials, constrain AI cost/output, and test prompt injection. If first-party fetching is added, validate resolved addresses and every redirect with egress isolation. Never infer KYC, reputation or delivery guarantees from OAuth or an AI-written profile.

### S12 — Moderate advisories: transitive dependency exposure remains

`npm audit --omit=dev` returned **six moderate affected packages, zero high and zero critical**, tracing to glob/minimatch denial-of-service advisories: [GHSA-3g3m-2fjr-6pw4](https://github.com/advisories/GHSA-3g3m-2fjr-6pw4) and [GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249). The affected dependency chains include Google authentication/Firestore tooling; this is not six independently demonstrated application exploits.

A non-forcing `npm audit fix` did not resolve them within current compatible dependency constraints. No incompatible transitive-major override was introduced and the lockfile is unchanged. Track upstream compatible upgrades, assess reachable use of glob patterns, and exercise auth/Firestore in staging before adopting a major dependency upgrade. Scheduled checks and Dependabot are prepared; the CI gate fails on high/critical production advisories.

## Prepared changes and operating impact

| Action | Short-window quota | Daily quota |
| --- | --- | --- |
| Create project | 5 / 10 minutes | 30 |
| Submit/practice proposal | 10 / 10 minutes | 100 |
| Send message | 30 / minute | 1,000 |
| Upload source | 10 / 10 minutes | 50 |
| Generate profile | 3 / 10 minutes | 20 |
| Generate project brief | 10 / 10 minutes | 60 |

Limits are initial operational settings in `src/lib/security/rate-limit.ts`. Attempts consume quota before payload validation; invalid traffic therefore cannot get unlimited downstream work. Accounts and actions have separate budgets, and role/membership changes do not reset them. Failure of the quota store temporarily blocks these six writes; billing cancellation and reads are not routed through that gate. Quota checks introduce Firestore transactions and TTL deletions with corresponding cost.

Terraform additionally prepares a TLS 1.2 minimum/MODERN profile, attached Cloud Armor API per-IP throttle in **preview**, and load-balancer logging. Preview is observation, not blocking. Tune shared-IP behavior before enforcing the default 120 API requests/minute/IP. Budget for recovery, edge protection and logging; restrict log access/retention because OAuth callback queries may contain short-lived authorization codes. No WAF managed-signature enforcement is claimed.

## Verification record

- Baseline: 246/247 JavaScript tests passed; one stale test expected repository imports that the implementation deliberately excludes. That expectation was corrected without restoring repository ingestion.
- Final full suites: 258/258 JavaScript tests on Node 22.23.4 and Node 24.22.1; six Python tests passed.
- Typecheck and Next.js 16.4.5 production build passed. Terraform 1.13.5 initialization without a backend, provider-lock validation, formatting and configuration validation passed.
- Regression coverage: missing/false Content-Length, UTF-8 byte limits, chunk cancellation, malformed bodies, bounded multipart, two-instance shared quotas, account/action isolation, daily limits, fail-closed behavior, quota wiring, participant isolation, proposal input restrictions and immutable release behavior.
- Local built-server smoke: sign-in 200; session 200; anonymous conversations/billing status 401; browser-security and API no-store headers present.
- `git diff --check` and deployment shell syntax check passed. Dependency advisories remain as stated above.
- **Not performed:** production deployment, Terraform plan/apply, live account/processor tests, restoration, sustained load tests or independent red-team validation. Cloud controls and the sign-in configuration issue remain unchanged in production.

## PR continuation after owner authorization

The owner authorized the program and requested one PR, retaining Google secret setup. They requested UI mockups before any application-screen changes. The branch was rebased onto `origin/main` (`4475e89`) so the source/deployment mismatch above is a historical inspection boundary, not a claim that the branch still omits those changes.

Additional prepared controls: billing checkout/card/confirmation and Nango session/import quotas, an AI generation emergency switch with output-token defaults, sanitized renewal-batch failure logging, Monitoring policy definitions with owner-supplied notification channels, and pinned CodeQL scanning. The direct Google authentication library was upgraded to 11.3.4 and exercised by the suite; six moderate transitive advisories remain. This supersedes the earlier statement that the dependency lockfile was unchanged.

UI proposals are in `docs/security-mockups/index.html`; they are not application routes and are not connected to APIs. Reporting/blocking/appeal/privacy implementations remain gated by owner review of these flows. See `docs/security-operations.md` for explicit remaining operational gates. GitHub branch-protection inspection returned HTTP 403; no protection settings were silently assumed or changed. No production apply, key retirement or real payment test has been performed.
