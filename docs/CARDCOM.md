# Cardcom membership billing

Implementation branch: `feat/cardcom-billing`. Billing stays disabled by default until credentials and sandbox verification are complete. No production resources, secret values, payments or existing memberships were changed during implementation.

## Product behavior

Existing accounts retain grandfathered access. New accounts keep their existing 14-day trial. After expiry, members can explicitly approve ₪19.99 now and automatic monthly renewal. No card or debit is required for the trial. The price is VAT-inclusive where applicable. Cardcom hosts card entry; the app never handles PAN or CVV. A successful payment grants one calendar month, with month-end clamping. Renewals run every 15 minutes; access expires at the paid-through time while payment is unresolved. A delayed successful renewal grants a full month from verification. Cancellation disables future renewals, retaining paid access. A debit already sent before cancellation can complete; uncertain outcomes remain queued for reconciliation without sending another cancelled debit.

## Credentials and deployment

The attached Python provider and setup script are reference material from `crypto-coral-328619`, not scripts to run against this project. The setup script lists three Cardcom credential secrets, plus optional webhook and sweep secrets.

Credentials supported by this implementation:

- `CARDCOM_TERMINAL_NUMBER`: terminal authorized for this merchant/site and ILS.
- `CARDCOM_API_NAME`: API login for that terminal.
- `CARDCOM_API_PASSWORD`: optional compatibility with the attached adapter. The current v11 OpenAPI schemas for checkout, token charging and external-ID lookup require terminal number and API name only. Confirm permissions with a sandbox token charge; do not create an unnecessary password secret.

No additional application webhook secret or sweep key is required: webhooks only trigger a server-to-server read of the previously stored checkout; the renewal endpoint verifies a Google-signed OIDC token and exact scheduler email/audience. Never trust callback amounts, tokens, user IDs or redirect success flags.

Example Terraform settings (references only; replace project/name/version with actual metadata):

```hcl
billing_enabled = true
cardcom_secrets = {
  CARDCOM_TERMINAL_NUMBER = { project = "crypto-coral-328619", name = "cardcom-terminal-number", version = "1" }
  CARDCOM_API_NAME        = { project = "crypto-coral-328619", name = "cardcom-api-name", version = "1" }
  # Optional only if your terminal needs it:
  # CARDCOM_API_PASSWORD = { project = "crypto-coral-328619", name = "cardcom-api-password", version = "1" }
}
```

The secret-owning project must allow granting the Freelance runtime service account secretAccessor on these exact secrets. Terraform creates these scoped grants and injects pinned versions into Cloud Run; no value enters Terraform state. The deploy identity needs permission to manage these grants in the owning project. Alternatively, create separate site-specific credentials in this project's Secret Manager. Do not assume the other site's broad compute-account permissions apply here.

Terraform also enables Cloud Scheduler, creates its service account/job, and adds Firestore composite indexes for due subscriptions and recent payment history. The applying identity needs `iam.serviceAccounts.actAs` on the scheduler account. Cloud Scheduler's service agent needs its standard `roles/cloudscheduler.serviceAgent` grant (normally granted when the API is enabled). No GCP billing-account changes are needed. The existing image-only release script does not apply configuration: apply the reviewed Terraform configuration with the current immutable image reference as part of rollout. Allow the index to finish building before enabling billing. Cloud Run and the public HTTPS load balancer must allow the scheduler and Cardcom callback to reach their API routes.

Confirm with Cardcom that the terminal supports tokenization, recurring merchant-initiated token payments, the site's domain/3DS rules and automatic invoice/receipt emailing. Confirm merchant identity, VAT-inclusive product pricing, invoice template/VAT treatment and customer service/cancellation details before enabling. This implementation does not support charging freelancer project fees, foreign B2B tax exemptions, automatic refunds, or card changes while a subscription is active. Refund requests go through the published contact; process the financial refund and access correction together administratively.

## Data and recovery

Server-only Firestore collections: `billingOrders` (initial and renewal ledger), `billingSubscriptions` (token, expiry, consent version/time, scheduler lease and renewal state), `billingTransactions` (unique gateway transaction claims). Public APIs expose only payment summaries and card suffixes. Client access to these collections must remain denied; all app access uses the server Admin SDK. Tokens are payment credentials; restrict IAM and never export them into logs or profiles.

Each initial checkout is persisted before the hosted URL is returned. One pending checkout per member is reused, including after a declined card attempt. An uncompleted hosted form does not activate a subscription. Completed callbacks and browser confirmation use `GetLpResult` and validate order ID, saved LowProfileId, terminal, operation, transaction success/ID, ILS currency and exact amount. Missing token/expiry leaves the order unfulfilled for investigation; do not tell the customer to pay again. Transaction IDs are claimed atomically with paid access. Duplicate callbacks do not extend access.

Renewals use a deterministic member-and-cycle `ExternalUniqTranId` and a Firestore lease. Unknown network outcomes are retried with the same key; Cardcom's duplicate code 608 requires lookup and verification of the original transaction. A definitive gateway decline turns automatic renewal off (`past_due`); existing paid access remains and the member can rejoin after expiry. Unverified responses remain unresolved and are retried/reconciled; inspect their ledger records and Cardcom reporting without issuing a new debit/key. Cancellation during an uncertain renewal permits only lookup of the existing gateway key. If no charge exists, that record needs operator resolution; it cannot start a new charge after cancellation. A pending reconciliation blocks another checkout for that account.

A successful debit with failed invoice issuance still grants access and records `invoicePending`. Monitor and resolve these in Cardcom; never repeat the debit to repair an invoice. History shows document numbers rather than unvalidated gateway URLs. The status API returns the 50 most recent paid ledger rows per account; use the server ledger/Cardcom reporting for older records. Keep transaction records for statutory accounting/retention requirements.

## Required sandbox acceptance

1. Use Cardcom-issued test terminal credentials, an HTTPS callback/return URL, and sandbox accounts whose trials have expired. Never test live debits on a customer's card.
2. Complete the hosted `ChargeAndCreateToken` form. Verify ₪19.99, correct inclusive VAT and emailed document, suffix/expiry, paid access and next renewal date.
3. Exercise declined, cancelled and incomplete checkout; replay callbacks/confirmations and attempt a different user's order. No false activation or duplicate extension.
4. Make a sandbox subscription due and invoke the OIDC-authenticated scheduler. Verify one debit and invoice; run overlapping invocations and retry after a simulated timeout. The external ID must stay identical.
5. Cancel before a renewal and during an uncertain result. Verify no future debit, correct reconciliation and paid-through access. Exercise a declined renewal and invoice failure.
6. Verify checkout/renewal fail closed with missing credentials, mismatched amount/currency/terminal, disabled billing and invalid scheduler identity.

Local tests cover the adapter and transactional service with an in-memory Firestore double; a live sandbox round trip remains required before activation. GCP access in this chat could not be verified: `gcloud` was initially absent and was installed at `/workspace/tools/google-cloud-sdk/bin/gcloud`; it has no active authenticated account. The configured application-credentials variable was not a usable file path, and the supplied base64 binding was not parseable service-account JSON. Repair those bindings in the cloud environment settings rather than sending credentials in chat.

## Local validation completed

- Production build and TypeScript passed.
- 15 billing/membership tests and nine SEO tests passed.
- Terraform formatting and provider-backed validation passed (no plan/apply).
- Chromium checks with mocked account/billing responses passed at mobile and desktop sizes: explicit consent gating, cancellation feedback and no horizontal overflow. Actual API checks rejected signed-out requests and malformed callbacks, and disabled renewal returned 503.
- No live checkout, token debit, invoice delivery, Google IAM grants, Scheduler job execution, or production deployment was performed. These require repaired GCP authentication and sandbox credentials.

## Authentication follow-up

The local cloud environment script now explicitly exports `GCP_PROJECT=freelance-514118`. An exposed older service-account key was identified without displaying its contents; its IAM disable request succeeded, and a fresh authentication attempt using that old key was subsequently rejected with `invalid_grant`. It must not be used for billing validation.

The independently verified replacement credential has not reached this running chat: the configured credential file is absent, both inspected gcloud configurations have no authenticated account, and the current `GCP_SA_KEY_B64` binding is not valid base64 service-account JSON. Apply the verified configuration to this environment before continuing secret inventory, Terraform planning and Cardcom sandbox acceptance. The local override does not update the reusable environment's saved variable binding. No billing infrastructure was deployed and billing remains disabled.
