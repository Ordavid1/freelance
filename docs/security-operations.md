# Security operations and review handoff

## Review boundary

This PR prepares application/infra controls and UI mockups. Production UI must stay unchanged until the mockups in `docs/security-mockups/index.html` are approved. Google secrets/provider configuration remain with the owner. No keys are disabled and no production resources are applied by opening this PR.

Monitoring channels are deliberately not invented: set `security_notification_channels` to verified channel resource names, send a test notification, and assign a responding person. Policies with empty channel lists do not page anyone. CodeQL upload on private repositories requires the corresponding GitHub entitlement. Branch-protection inspection returned HTTP 403 with the connected integration; an administrator must configure required checks and reviews.

## Renewal failure or uncertain payment

1. Confirm whether the processor accepted the existing cycle's deterministic `ExternalUniqTranId`. Never generate a new ID to retry an uncertain charge.
2. Compare terminal, transaction ID, amount, currency, refund status and internal transaction claim. A hosted redirect or client assertion is not evidence of payment.
3. Preserve cancellation intent. Inspect only the affected account through authorized support tooling; do not export card tokens or bulk customer records to logs/tickets.
4. Resolve exceptions with a second reviewer for financial adjustments. Record actor, reason and processor reference. Do not modify historical payment records to hide a discrepancy.
5. Reconcile daily and record unresolved count and oldest age. The current batch scheduler is not a complete reconciliation service; automated processor export integration remains required before financial-operations signoff.

## AI abuse / spending incident

Set `ai_generation_enabled=false` through the production variable set and deploy that configuration. This blocks new Vertex generation without cancelling memberships. In-flight calls may finish. Restore only after reviewing account/edge quotas, provider usage and false positives. Configure billing budgets separately: budget alerts notify and do not impose a hard spending cap. Do not automatically disable the entire billing account or stop customer cancellation routes.

## Data recovery drill

Enable PITR and daily backups; check the actual earliest recovery time and backup completion. Restore into a separate, access-restricted database rather than overwriting production. Validate project ownership, participant links, source references and billing transaction claims. Reconcile processor activity since the restore point before enabling writes or renewals against restored data. Record recovery point, duration, missing data and signoff. Do not delete the existing database or backup history during rollback. Backup configuration is not proof of recoverability until this drill passes.

## Credential migration (owner managed)

Inventory each active agent key's consumer, scopes and last use. Establish short-lived federation and test the same required operations before disabling one old key at a time. Remove project-wide secret administration in favor of named-resource access after identifying provisioning needs. Keep a recovery identity outside the automation account. Never put replacement secrets in chat, Git or a Terraform variable. Google secret changes remain with the owner.

## Privacy and evidence

Document active-data, archived-generation, soft-delete, backup and processor retention separately. A privacy request must authenticate the requester, exclude another party's private data, preserve required financial/evidence holds and return a request receipt. Do not promise immediate purge. Reports, blocking, appeals, export/deletion workers, moderator authorization/MFA and evidence access still need implementation after the proposed user journeys are approved. Current mockups are not connected to any data or API.

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
