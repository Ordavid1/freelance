# Security operations and review handoff

## Review boundary

This PR prepares application/infra controls and UI mockups. The owner approved blocking/unblocking, restricted-account notices and appeals. Report forms and privacy-request flows are on hold; do not implement or activate them. Google secrets/provider configuration remain with the owner. No keys are disabled and no production resources are applied by opening this PR.

Monitoring channels are deliberately not invented: set `security_notification_channels` to verified channel resource names, send a test notification, and assign a responding person. Policies with empty channel lists do not page anyone. CodeQL upload on private repositories requires the corresponding GitHub entitlement. Branch-protection inspection returned HTTP 403 with the connected integration; an administrator must configure required checks and reviews.

## Renewal failure or uncertain payment

1. Confirm whether the processor accepted the existing cycle's deterministic `ExternalUniqTranId`. Never generate a new ID to retry an uncertain charge.
2. Compare terminal, transaction ID, amount, currency, refund status and internal transaction claim. A hosted redirect or client assertion is not evidence of payment.
3. Preserve cancellation intent. Inspect only the affected account through authorized support tooling; do not export card tokens or bulk customer records to logs/tickets.
4. Resolve exceptions with a second reviewer for financial adjustments. Record actor, reason and processor reference. Do not modify historical payment records to hide a discrepancy.
5. Reconcile daily and record unresolved count and oldest age. The current batch scheduler is not a complete reconciliation service; automated processor export integration remains required before financial-operations signoff.

## AI abuse / spending incident

Generative AI has three independent brakes. Any one of them stops it; none cancels memberships, and customer cancellation routes are never stopped. In-flight calls may finish.

1. Environment: `ai_generation_enabled=false` in the production variable set, then deploy (`AI_GENERATION_ENABLED=false`). Slowest, and it also overrides the switch below.
2. Runtime switch: the Firestore document `runtimeSwitches/ai`. `enabled: false` stops AI on every instance within 30 seconds, with no deploy. Anything else (missing document, `enabled: true`, no field) leaves AI to the environment value. The document cannot turn AI on when the environment turned it off.
3. Site-wide budgets: hourly and daily ceilings per cost feature (see below), one counter shared by all instances.

### Automatic cut-off

A Cloud Billing budget (`infra/terraform/budget-guard.tf`; set `billing_account_id` and `budget_amount`) publishes spend at 50%, 90% and 100% to Pub/Sub. The push subscription calls `POST /api/maintenance/budget` with an OIDC token for a dedicated service account (`BUDGET_ALERT_PUSH_EMAIL`). When `alertThresholdExceeded >= BUDGET_AI_CUTOFF` (default `1.0`; set `0.9` to cut at 90%) the endpoint writes `runtimeSwitches/ai {enabled:false, reason:'budget', threshold, at}`, appends a `securityAuditEvents` record (`runtime.switch.disable`, actor `system:budget`) and logs a `CRITICAL` line `budget_kill_switch`; alert on that line. Repeated notifications change nothing. Only AI is stopped, never the billing account.

### Turning AI back on (manual, deliberate)

Nothing in the application can re-enable it.

1. Find the cause: provider usage, the `securityRateLimits` budget documents, the `securityAuditEvents` record and the `budget_kill_switch` log.
2. Fix the cause. If the budget was simply too low, raise `budget_amount` first: while spend is still over the cut-off, Billing repeats notifications and the next one switches AI off again.
3. In the Firestore console open `runtimeSwitches/ai` and delete the document or set `enabled` to `true`. Instances pick it up within 30 seconds. If `AI_GENERATION_ENABLED=false` is also set, remove it and deploy.
4. Record who re-enabled it and why in the incident notes.

If Firestore cannot be read, the environment value stands: an outage cannot stop AI that was left on, and cannot turn on AI the environment disabled.

### Site-wide budgets

Each cost feature has an hourly and a daily ceiling, kept in one shared document per feature in `securityRateLimits` (TTL `expiresAt`). At a ceiling callers get `503 FEATURE_BUDGET_EXHAUSTED` with `Retry-After`. If the counter cannot be read the call is refused (`SECURITY_CHECK_UNAVAILABLE`), never allowed unmetered. Support triage at its ceiling is skipped and the customer's message is still delivered. A ceiling of `0` switches the feature off. Invalid values (negative, fractional, empty, non-numeric) are ignored and the default applies.

| Feature | Hourly variable (default) | Daily variable (default) |
| --- | --- | --- |
| `ai.profile` | `GLOBAL_BUDGET_AI_PROFILE_HOURLY` (60) | `GLOBAL_BUDGET_AI_PROFILE_DAILY` (300) |
| `ai.projectBrief` | `GLOBAL_BUDGET_AI_PROJECT_BRIEF_HOURLY` (120) | `GLOBAL_BUDGET_AI_PROJECT_BRIEF_DAILY` (1000) |
| `ai.supportTriage` | `GLOBAL_BUDGET_AI_SUPPORT_TRIAGE_HOURLY` (120) | `GLOBAL_BUDGET_AI_SUPPORT_TRIAGE_DAILY` (600) |
| `import.xplace` | `GLOBAL_BUDGET_IMPORT_XPLACE_HOURLY` (120) | `GLOBAL_BUDGET_IMPORT_XPLACE_DAILY` (600) |

### Other variables

| Variable | Purpose |
| --- | --- |
| `AI_GENERATION_ENABLED` | `false` stops all AI generation (default on). |
| `BUDGET_ALERT_PUSH_EMAIL` | Service account whose OIDC token may call `/api/maintenance/budget` (set by Terraform; the endpoint is unavailable without it). |
| `BUDGET_AI_CUTOFF` | Threshold fraction at which AI is switched off (default `1.0`). |
| `SUPPORT_SITE_HOURLY_LIMIT` | Site-wide ceiling on support chat messages per hour (default 300; was a fixed 100). Per-address limits apply first. |
| `CLIENT_IP_TRUSTED_HOPS` | Proxy entries appended after the client in `X-Forwarded-For` (default 1: the Google load balancer). |

### Anonymous per-address limits

Support chat and mail unsubscribe are limited per client address and action (support messages 10 per 10 minutes and 60 per day; unsubscribe 20 and 100). The address comes from `X-Forwarded-For` counted from the right: the Google external load balancer appends `<client>, <load balancer>`, so everything before the client entry is caller-controlled and ignored, and a spoofed header cannot choose its own bucket. An unparseable client entry maps to one shared `unknown` bucket. IPv6 is grouped by /64 and IPv4-mapped IPv6 is treated as the IPv4 address. Only a SHA-256 hash of the address and action is stored. If the deployment ever sits behind a different number of proxies, set `CLIENT_IP_TRUSTED_HOPS` accordingly: a wrong value makes every client look like the proxy.

## MCP server (AI assistants)

A public, read-only, anonymous MCP endpoint for AI assistants (src/lib/mcp). It is a new public surface, so it is **off until switched on**.

- **Enabling:** set `MCP_ENABLED=true` in the Cloud Run environment. The service environment is managed in `infra/terraform/main.tf`, which does not define the variable yet: adding it there is the go-live change. Any other value, or no value, keeps the endpoint off. While it is off, `POST /mcp` answers 404 and the `/ai` page, its sitemap entry, its footer link and its llms.txt lines do not exist (`requiresFeature` in the page registry); they all appear when it is on, with no code change.
- **Endpoint:** `POST /mcp` only (other methods get 405), stateless streamable HTTP with JSON responses, no sessions, no cookies and no CORS. A request with an `Origin` header other than the site's own is refused (403). The body is capped at 64 KB and must be one JSON-RPC message (batches are refused). Every refusal the adapter makes in front of the endpoint is a JSON-RPC error body (`errors` on `mcp.transport`), including the 429.
- **Killing:** the Firestore document `runtimeSwitches/mcp`. `enabled: false` stops the endpoint on every instance within 30 seconds, with no deploy. A missing document or `enabled: true` leaves it to the environment value, and the document can never turn the endpoint on when `MCP_ENABLED` is not `true`. If Firestore cannot be read the environment value stands. Re-enabling is manual: delete the document or set `enabled` to `true`.
- **Policy:** the endpoint is the registry operation `mcp.transport`; every tool runs under its own registry operation through `defineTool` (src/lib/mcp/policy.ts), which applies the same budget step as HTTP routes (`enforceOperationBudgets`, src/lib/security/budgets.ts). A tool can only use operations an anonymous caller may use: no user, moderator or scheduler auth, no `active` account, no membership, no bot check.
- **Burst limits** (`burstLimits` in `src/lib/security/burst-limit.ts`): `mcp.request` allows 120 calls per minute and 600 per ten minutes per client address. The counters are **per instance, in memory**, not shared. A Firestore counter per request would cost more than the cached read it protects, and one Firestore document contends above about one sustained write per second; AI platforms also call from shared egress addresses. The limit protects the instance CPU and bounds one source. The effective ceiling is therefore the limit times the number of running instances, and total cost is bounded by caching of the public readers and the Cloud Run max-instances setting. The table holds at most 20,000 addresses per instance (expired entries first, then the oldest are dropped). The address is the normalised client address of `client-ip.ts`; callers that cannot be attributed share the `unknown` bucket. A refused call answers `429` with `Retry-After`. Operations that spend money or write data must not use a burst limit instead of the Firestore limits.
- **Logs:** one `mcp_request` line per request that reaches the server (JSON-RPC method, status, milliseconds, and on `initialize` the client name and version the caller declares, as capped ASCII); one `mcp_tool_call` line per tool or resource call (tool, operation, outcome `ok`, `denied` or `error`, milliseconds); and an `mcp_tool_error` line (`ERROR`) with the error class name only when a handler fails. No line holds an address, parameters or arguments. Requests refused before the server runs (404, 403, 400, 413, 429) appear only in the Cloud Run request log. Callers only ever see a generic error text.

## Route policy

Every exported method in `src/app/**/route.ts` is `export const METHOD = route('<operation id>', ...)`. The operation registry (`src/lib/security/operations.ts`) declares per operation: authentication (user, optional user, moderator, scheduler OIDC, or public with a written reason), account state (`active` or `any`), per-account limit, site budget, anonymous limit, burst limit, bot check and membership. The adapter (`src/lib/security/policy.ts`) applies them in one fixed order: same-origin for mutating methods, authentication, account state, membership, bot check, budgets (burst limit first, then the Firestore budgets), then the byte-capped body. `tests/security-route-policy.test.mjs` fails the build when a route skips the adapter, an operation is unused or duplicated, a public operation has no reason, or a mutating operation open to restricted accounts is not on the reviewed list. Restricted and suspended accounts are denied by `active` operations (AI, uploads, profile save, imports, integrations, projects, proposals, messages, headhunter writes, checkout) and keep read, cancel, card, invoice, appeal, block, mail-preference, disconnect and logout access.

## Data recovery drill

Enable PITR and daily backups; check the actual earliest recovery time and backup completion. Restore into a separate, access-restricted database rather than overwriting production. Validate project ownership, participant links, source references and billing transaction claims. Reconcile processor activity since the restore point before enabling writes or renewals against restored data. Record recovery point, duration, missing data and signoff. Do not delete the existing database or backup history during rollback. Backup configuration is not proof of recoverability until this drill passes.

## Credential migration (owner managed)

Inventory each active agent key's consumer, scopes and last use. Establish short-lived federation and test the same required operations before disabling one old key at a time. Remove project-wide secret administration in favor of named-resource access after identifying provisioning needs. Keep a recovery identity outside the automation account. Never put replacement secrets in chat, Git or a Terraform variable. Google secret changes remain with the owner.

## Privacy and evidence

Document active-data, archived-generation, soft-delete, backup and processor retention separately. A privacy request must authenticate the requester, exclude another party's private data, preserve required financial/evidence holds and return a request receipt. Do not promise immediate purge. Report forms and export/deletion workers are intentionally deferred. Blocking and restriction enforcement, appeals, audited moderator APIs and recent-MFA authorization are implemented in this PR; they still need designated-user production validation. Current mockups are not connected to any data or API.

## Release checklist

- Review complete production variables and a non-destructive Terraform plan; do not use `engine_image=null` for an existing deployment.
- Configure/test alert recipients; review Cloud Armor preview and logging access/retention before enforcement.
- Run tests/typecheck/build, provider-lock Terraform validation and immutable-release checks.
- Keep Google/provider configuration with the owner; verify designated-account login after their change.
- Verify authorization with two designated users, cancellation, source upload/delete and provider sandbox outcomes.
- Record the deployed digest and rollback digest; never roll back financial state by silently reverting the database.
- Obtain approval of the proposed UI before implementing or activating any new customer-facing flow.

## Remaining release gates

This PR does not claim a completed four-week marketplace program. The audit's reporting/blocking/moderation/privacy flows await UX review; production restore/reconciliation drills, recipient setup, key retirement, processor reconciliation integration, historical secret scanning and organization policies require operational follow-through. Keep these visible when reviewing/merging rather than treating a green build as signoff.

## Offline reconciliation helper

`node scripts/security/reconcile-billing.mjs internal.json processor.json report.json` compares authorized normalized exports. Each input is an array of `{terminal: positive integer, transactionId: digit string, amountAgorot: integer, currency: uppercase ISO code, status: paid|refunded|declined}`. Use the provider's actual transaction identity, not a card token or checkout ID. Map partial refunds/voids explicitly in a reviewed normalization step; unsupported states must not be silently relabeled.

The helper rejects duplicates, flags missing/mismatched records and writes a new owner-readable report containing references/reasons, excluding customer identities and raw rows. Exit 0 means matching exports, 2 means exceptions, 1 means invalid input/output. It never calls the processor or changes financial records. Secure and delete source exports according to retention policy; never commit them. This is a review aid, not an automated provider reconciliation integration.

## Approved safety implementation

`GET/POST /api/marketplace/safety` authorizes participants against a real existing conversation. Blocking is a canonical peer-pair record, affects future proposals across projects and messages in both directions, and unblocking removes only the caller's block. Existing history and billing access remain available. Relationship and account state are read in the same transaction as message/proposal writes. Project publication checks account state before creation.

`POST /api/marketplace/appeals` accepts one immutable pending request per own restriction version. `GET/POST /api/moderation/accounts` require a verified, non-revoked moderator session with trusted `moderator=true` claim, second-factor evidence and authentication within five minutes. Configure moderator onboarding/MFA through the trusted Auth administrator; ordinary Google login does not automatically grant this authority. The API cannot be used for self-modification. Supply `appealId` to resolve only the matching current pending appeal; stale/foreign appeals return 409. Decisions, block changes, appeals and queue access append restricted audit records. No moderator dashboard or report/privacy form has been added.

Run `python3 tests/browser/security_ui.py` with the built app listening on 127.0.0.1:3100 and Python Playwright/Chromium installed. It intercepts APIs with synthetic test data, verifies mobile confirmation, block/unblock, repeated sends, restriction, appeal and retained membership navigation, and saves review screenshots. Backend authorization is separately exercised in `security-contact-policy` and `security-safety-routes` unit tests. These do not replace live Firestore contention/rules and designated-user acceptance checks.
