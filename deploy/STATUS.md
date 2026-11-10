# Security inspection — 10 November 2026

Read-only GCP metadata and public HTTP checks confirm the canonical HTTPS site is live with an ACTIVE certificate. Cloud Run revision `freelance-engine-00037-2vj` receives all traffic; direct `run.app` access returns 404. Membership billing and its renewal scheduler are enabled. Google Identity Platform's provider is enabled, but the Cloud Run Google sign-in UI flag is false and the live page says Google sign-in is unavailable. The application now accepts Google sessions only.

The older status below is historical and does not describe current billing, DNS, auth or certificate state. See the [security audit](../docs/audits/2026-11-10-marketplace-security.md) and [prioritized plan](../docs/security-plan.md). Hardening changes in this checkout have not been deployed or applied to GCP.

# Historical production update — 9 November 2026

- Cloud Run, external HTTPS load balancer, static IP and managed certificate have been provisioned. Terraform applied 14 additions, one display-name update and no deletions; a post-apply plan showed no changes.
- Final legal-page source `16c6eb1` was deployed successfully by GitHub run `42528089837`. Cloud Run revision `freelance-engine-00003-rgr` is Ready and has 100% of traffic.
- Production IP: `136.81.206.15`. Public DNS still targets Squarespace; DNS cutover and public HTTPS/page verification are pending. The managed certificate is PROVISIONING.
- The IAM/bootstrap and GitHub build-source access blockers below are resolved. Payment remains unavailable; the profile-started trial is implemented and reflected in the policies.
- Full source/image/DNS details and the remaining authenticated-browser dependency are in [LEGAL-RELEASE.md](LEGAL-RELEASE.md).

The following is the historical pre-release status, retained for context; statements that no Cloud Run service or edge exists are superseded by the update above.

# Deployment status — 2026-11-08

## Implemented in the review branch

- Firebase email/password authentication with verified-email checks, HttpOnly session cookies, CSRF-safe session exchange, and logout. Google sign-in UI is present but the Identity Platform Google provider still needs the owner's OAuth client configuration.
- Firestore-backed account profiles, marketplace projects, saved projects, proposals, and proposal-linked conversations with server-side ownership checks.
- Private Cloud Storage profile sources, per-user listing/deletion, and AI processing from the owner's stored files.
- GitHub and LinkedIn user authorization/import/disconnect through Nango. `NANGO_API_KEY` version 1 is ENABLED, verified from version metadata only. Terraform prepares secret-scoped runtime access and pins the Cloud Run secret reference to version 1; these still need applying with deployment. Provider OAuth integration configuration still needs validation.
- The project review branch is configured for Cloud Run behind a public HTTPS load balancer, with application-level authentication for private actions. Ignore rules cover local environment files, credentials, build output, logs, Terraform state/plans, and editor noise while preserving `.env.example` and the Terraform lock file.

## GCP state

The previous authorized Terraform applies created the Firebase Web App, Identity Platform email configuration, Firestore `(default)` in `me-west1`, and private versioned upload bucket in `me-west1`. Email/password sign-in is configured. The Google button is hidden until Google OAuth is configured and the runtime flag is enabled. The app does **not** yet have a Cloud Run service or external load balancer because no application image has been released. The GCP billing attachment was not changed.

`freelance-place.com` is the intended production origin. Terraform now defines a global external HTTPS load balancer with a Google-managed certificate for the apex and `www`, HTTP-to-HTTPS redirect, and a dedicated static IP. These domain resources are conditional on the first `engine_image`; the DNS target IP is therefore not yet provisioned. Direct Cloud Run domain mapping cannot be used in `me-west1`.

The Squarespace DNS page currently has Squarespace default A/HTTPS records at `@`, a Squarespace `www` CNAME, and separate email-security TXT records. DNS has not been changed. When the load balancer has an IP, replace only the website records with the Terraform A/CNAME outputs; retain email-security records and the `_domainconnect` record.

## Remaining launch work

- Owner supplies the Google OAuth web client ID/secret through the approved secret store, and confirms any provider setup needed for Google Identity Platform.
- Validate Nango GitHub/LinkedIn OAuth configuration and apply the runtime secret access binding/reference; never send secrets in chat or store them in Git.
- Apply the reviewed Terraform configuration with a digest-pinned image, then add the resulting apex A and `www` CNAME records in Squarespace.
- Wait for the managed certificate to become active; verify both hosts, HTTPS redirect, email/Google sign-in, per-user data boundaries, uploads, social import/disconnect, Vertex routes, and logs.
- Messages, conversation storage, billing, profile discovery, and several prototype-only UI surfaces are still unfinished. Membership remains clearly non-billed; do not take payments or change GCP billing.

## Verification completed in this checkout

- `npm run typecheck` — passed.
- `npm run build` — passed.
- `terraform -chdir=infra/terraform fmt -check -recursive` and `terraform -chdir=infra/terraform validate` — passed after the load-balancer configuration was added.
- `terraform -chdir=infra/terraform plan -detailed-exitcode` — no changes after the authorized domain/API prep apply.
- `git diff --check` — passed.

These checks validate the local source/configuration, not a deployed or end-to-end production service.
