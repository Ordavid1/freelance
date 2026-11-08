# Deployment readiness audit — 2026-11-08

## Local source and configuration

- TypeScript check and production build pass on Next.js 16.4.5 / Node 22.
- Terraform is formatted and validates with the locked Google provider.
- Ignore files exclude secrets, local env files, credentials, Terraform state/plans, generated output, and irrelevant build context. `.env.example` and `.terraform.lock.hcl` remain tracked.
- Authentication/session routes, profiles, projects, saved projects, proposals, proposal-linked conversations, private uploads, and Nango GitHub/LinkedIn integration routes are implemented in the current review checkout.

## GCP resources

- The Firebase Web App, Identity Platform email/password config, Firestore database, and private upload bucket have been applied to `freelance-514118`; Firestore and uploads are in `me-west1`.
- The GCP billing attachment was not modified.
- No Cloud Run service or external load balancer has been created. Terraform provisions those only once an immutable image is supplied.
- The service region is `me-west1`. Cloud Run's direct custom-domain mapping is not offered in this region, so Terraform now prepares a global external HTTPS load balancer, managed certificate, redirect, and static IP.
- No Squarespace DNS edits have been made. The current `@`/`www` records target Squarespace; email TXT records are distinct and must be preserved.

## Production blockers

- Google sign-in requires the owner's OAuth web client configuration in the authorized secret/configuration path. Email/password is configured.
- GitHub and LinkedIn are implemented via Nango. `NANGO_API_KEY` version 1 is ENABLED, confirmed by version metadata without reading its value. The earlier no-version report was incorrect. Runtime secret access and the version-1 Cloud Run reference are prepared in Terraform and still need applying at deployment; provider OAuth configuration needs validation.
- The first image, Cloud Run service, load-balancer IP, DNS records, and managed certificate are not yet live.
- Messages/conversations, billing, real freelancer discovery, and several prototype surfaces are not backed by production data. Payment remains disabled.
- Per-user security, provider setup, OAuth callbacks, and data flows have not had end-to-end live-user validation.
- The Squarespace DNS page is accessible in the browser, but no Squarespace MCP tool is connected. DNS was inspected via the provided authenticated browser tab and remains unchanged.

## Current Squarespace DNS view

The authenticated Squarespace DNS page for `freelance-place.com` showed Squarespace default records: apex A and HTTPS records, `www` CNAME to Squarespace, `_domainconnect`, and email-security TXT records. There were no custom records. DNS is unchanged. After Terraform creates the load balancer, use its static IP for the apex A record and point `www` to the apex. Remove/replace only the Squarespace website preset records; retain the unrelated email and domain-connect records.

## Safe release sequence

1. Supply OAuth configuration and make the Nango secret available without sending credentials in chat.
2. Build a digest-pinned image and inspect the Terraform plan, including the public website invoker binding and load-balancer resources.
3. Apply the reviewed plan, then set Squarespace's apex A and `www` CNAME to the published outputs.
4. Verify certificate readiness and end-to-end sign-in, authorization boundaries, projects/proposals, private upload/import/deletion, Nango disconnect, AI behavior, and error paths.
5. Keep billing disabled and do not alter the GCP billing attachment.

## Verification boundary

Local typecheck, production build, Terraform validation, and whitespace checks pass. This is not evidence of a deployed Cloud Run service, active certificate, configured Google/Nango OAuth, or complete end-to-end marketplace operation.
