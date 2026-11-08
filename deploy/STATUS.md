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
