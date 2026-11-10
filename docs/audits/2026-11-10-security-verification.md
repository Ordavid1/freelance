# Security verification follow-up

Scope: owner requested recovery validation (3), Google/moderator setup (4), abuse/spend protection (7), remaining hardening (8), and email delivery (2). Report and privacy-request forms remain deferred.

## Completed evidence

- Created owner-authorized email channel for `or@ailead.work` and connected both live alert policies. Channel is enabled; no verification requirement was returned by the API. This establishes configuration, not proof of inbox receipt.
- Confirmed PITR enabled and inspected scheduled backups. No daily snapshot had completed yet. Two PITR clone requests were rejected with HTTP 403 before creating a destination; no data was copied, changed or deleted.
- Confirmed missing `datastore.databases.clone` and `datastore.databases.create` permissions. A reviewable owner-run grant script provides a two-hour clone role and separately scoped cleanup permission for `security-restore-drill-*` databases only. The production database cannot be deleted through that cleanup grant.
- Corrected the earlier sign-in assessment: the initial SSR warning disappears when Firebase configuration loads; the live Google button is enabled after hydration. Provider is enabled. No actual OAuth login was performed on the owner's behalf, and no Google secrets were read or changed.
- Owner email has no Firebase account yet. Moderator access was not granted to an unverified or invented identity. Enrollment requires the owner to sign in and complete MFA personally. Project MFA is currently disabled. The proposed security-enrollment UI awaits the owner's UI decision.
- Reviewed four hours of Cloud Armor preview logs: 368 entries, zero preview denials, complete pagination. Prepared enforcement at 600 API requests/minute/IP rather than 120 to accommodate shared networks. Per-account action limits remain unchanged.
- Synthetic load invoked the actual profile route four times concurrently with 24 MiB of stored documents per request and a stubbed provider: 403 MiB peak RSS, approximately 985 ms; four successful responses; zero cloud calls. Prepared 1 GiB memory and concurrency four per instance. This is not a live Vertex throughput benchmark or a monetary cost guarantee.
- Resolved all six moderate production advisories with a reviewed `rimraf@^6.1.4` override (Node 22 compatible). The affected Google SDK build dependencies do not import rimraf in their runtime JavaScript; the updated closure uses fixed glob/minimatch versions. Production npm audit reports zero vulnerabilities. Exercise SDK/provider flows during rollout.
- Scanned all fetched reachable Git history (129 commits) with checksum-verified Gitleaks 8.30.1. Six findings were public IndexNow identifiers/fixtures, public LinkedIn OAuth client IDs and a Secret Manager resource-name string. Exact historical fingerprints were reviewed and recorded in `.gitleaksignore`; no whole directories/rules were disabled. Re-scan reports no remaining findings. A redacted CI history scan is prepared.
- Prepared nonce-based CSP with no executable inline-script allowance. Browser verified normal Google-button hydration and blocked parser-inserted attacker markup. Existing mobile block/appeal flows still pass with the stricter policy. Inline styles remain allowed for current layouts; this is not a claim that every third-party OAuth roundtrip was tested.
- Prepared hourly private maintenance for abandoned upload reservations older than 24 hours. Ready files are protected; exact ownership/path/generation are checked, finalization respects cleanup claims, and mismatches/failures move to operator review. It does not implement privacy deletion or indiscriminate deletion of objects without a reservation.

## Owner/integration barriers

- Recovery clone/create: Google Cloud HTTP 403. Run `scripts/security/grant-recovery-drill.sh` using the existing project-admin identity, then the drill can proceed and temporary data can be removed. No permanent broad role is requested.
- Branch protection: GitHub integration returns HTTP 403 for repository administration. An owner must enable administration access for the integration or configure required PR review/checks in Settings. Required checks should include application, infrastructure, CodeQL and secrets. No claim of branch-protection enforcement is made.
- Billing budgets: enabled Cloud Billing/Budgets APIs, then the billing metadata/budget request was denied with HTTP 403. A billing-account administrator must configure a project-filtered spending budget or provide appropriately scoped access. Budget notifications are not a spending cap; no arbitrary dollar threshold was silently imposed.
- Moderator enrollment: owner must sign in once with the intended Google identity, approve the compact enrollment UI, and enter authenticator codes only in that UI—not chat. Trusted moderator claims must follow verified identity and enrollment.

## Rollout boundary

The email channel/policy connections are live. Other source changes in this follow-up require their own reviewed release and non-destructive Terraform plan. The previous PR #10 is already merged. Never interpret working-branch code or a green build as proof that these later controls are deployed. A completed recovery drill, actual notification receipt, provider roundtrip and moderator onboarding remain explicit verification gates.
