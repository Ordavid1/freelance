# Deployment readiness audit — 2026-11-08

Live inspection from the laptop account, against project `freelance-514118` (explicit project flags; the laptop default project is different).

## Verified gaps

- Cloud Run list in me-west1 returned no services.
- Global Workload Identity Pool list returned no pools. GitHub OIDC provider URI in the workflow is therefore not usable yet.
- Project IAM has no role bindings for freelance-runtime, freelance-builder, or freelance-deployer. Existing for-ai-agents roles do not establish these deployment identities' permissions.
- Secret Manager API is disabled. Secret metadata cannot yet be listed; no secret values were accessed.
- GitHub repository secret and variable listings are empty. OIDC uses workflow literals, so a GitHub service-account key should NOT be added as a workaround.
- Workflow builds/pushes an image then expects Cloud Run to already exist. First service creation still requires Terraform with engine_image set.

## Application gaps that block a public production launch

- No account authentication, server session validation, or membership authorization.
- Projects, bids, profiles and chat are fixtures/browser storage, with no durable shared database or ownership checks.
- AI endpoints accept unauthenticated requests; require authenticated access, quotas, upload bounds and rate limits before public exposure.
- Missing GCP configuration currently returns example AI content. Production must fail closed instead of producing mock profile facts.
- Social buttons collect public URLs. There are no OAuth start/callback handlers, provider tokens, scopes, client IDs or client secrets.
- Recommendations use illustrative candidates rather than a real freelancer index.
- Billing provider and webhooks are unimplemented, by prior product decision.
- NEXT_PUBLIC_SITE_URL defaults to an unconfirmed domain. Real production origin is needed before configuring canonical URLs and provider callbacks.

## Configuration required

Already in Cloud Run Terraform: GOOGLE_CLOUD_PROJECT and GOOGLE_CLOUD_LOCATION.
Needs explicit selection/configuration: VERTEX_MODEL_ID, production origin, authentication provider, database, session configuration, source storage/retention and OAuth providers.

OAuth callback URIs cannot be honestly declared configured: no callback route exists yet and no production domain has been chosen. Register exact callbacks only after implementing the selected authentication library/provider routes. LinkedIn, GitHub, Dribbble and Behance must each be checked for available API access and approved scopes; entering a public URL is not authenticated access. Personal websites can continue through public URL ingestion.

## Safe handoff

Application source has been copied from the prior laptop workspace into a review branch, preserving the infrastructure files. No private .env files, credentials, node_modules or build output are included. Do not merge to main or publicly deploy until the application gates above are implemented. The main workflow deploys on push.
