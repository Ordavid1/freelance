# Legal pages: deployed application, domain cutover pending

Status as of 9 November 2026 (Asia/Jerusalem). The Hebrew privacy policy (`/privacy`) and terms (`/terms`) are implemented and deployed to the production Cloud Run application. **The public domain cutover and public HTTPS verification are not complete.**

Operator/contact: Or David AI Assimilation Services (Or David), `or@ailead.work`. The original legal work was merged through [PR #2](https://github.com/Ordavid1/freelance/pull/2). Subsequent revisions reconcile the profile-started trial and use 9 November 2026 as the final legal update date. See [the evidence audit](../docs/legal-data-audit.md).

## Verified production application

- Application source: `16c6eb16d38fbb195a56b06414ad13f8b0b41396`.
- [GitHub production deployment 42528089837](https://github.com/Ordavid1/freelance/actions/runs/42528089837): **success**.
- Cloud Build: `591051b7-3919-4b22-a574-cc4c7e9948b6`, **success**.
- Cloud Run: `freelance-engine`, `me-west1`, revision `freelance-engine-00003-rgr`, Ready, 100% traffic.
- Immutable image:

```text
me-west1-docker.pkg.dev/freelance-514118/freelance/engine@sha256:4b3ac5891aa4d78db1fc52b00ddecb37ea67c8b9e59f6647d6e28ce41a144143
```

The initial Terraform apply completed with **14 additions, 1 update, 0 deletions**. It provisioned Cloud Run, the external HTTPS load balancer, managed certificate, redirect, static IP and scoped runtime/deployment grants. A subsequent infrastructure plan returned no changes. No billing-account attachment was changed.

The bucket metadata-reader grant fixed the GitHub build-source access failure. The owner applied `scripts/grant-release-iam.sh` from an administrator identity, enabling the cloud release. Its Cloud Run IAM bootstrap grant expires at `2026-11-08T23:47:31Z` (01:47 on 9 November in Israel). Existing production bindings remain after this temporary administrative grant expires. Administrator credentials were not transferred to the cloud agent.

## Remaining DNS step

Static production IP: **136.81.206.15**.

| Type | Host | Value |
| --- | --- | --- |
| A | @ | 136.81.206.15 |
| CNAME | www | freelance-place.com |

Replace only Squarespace's old website A records, its website HTTPS record with Squarespace IP hints, and its www CNAME. Preserve email/MX/TXT/security records and `_domainconnect`. No DNS edit has yet been made by this chat. Public DNS still returned Squarespace addresses at the last check.

The managed certificate `freelance-website-cert` covers `freelance-place.com` and `www.freelance-place.com` and is PROVISIONING pending the cutover. The HTTP frontend redirects to HTTPS. Direct requests to the Cloud Run URL return 404 under its load-balancer-only ingress policy, as intended; that URL is not a public fallback.

The cloud shared-browser tool failed before opening with `the gaas-browser node_repl sandbox cannot be disabled`. This chat has no local-browser control tool for the laptop Squarespace tab. TinyFish is now connected, but its Default profile has no recorded Squarespace sign-in. The user has authorized making the DNS changes; an authenticated browser connection is the remaining access dependency. Never request a password in chat.

## Validation boundary

TypeScript, the production build, nine SEO tests and four membership-state tests passed. Desktop/mobile browser checks verified both legal routes, Hebrew/RTL, contact and canonical links, contents anchors, footer navigation and no document overflow. The trial policy update covers eligibility state, trial timestamps, profile type, expiry restrictions, retained data and no automatic billing. No live customer rows or private content were read for this work.

After DNS is saved, verify the managed certificate becomes ACTIVE, then verify HTTP redirects, both hostnames, public HTTP 200 responses for `/privacy` and `/terms`, final legal content/date, footer and contextual links, and unauthenticated API boundaries. Do not report the custom domain as live until these checks pass. Optional Google/Nango provider flows have not been certified end to end by this legal-page task.

For future Terraform plans, retain a non-null production image setting, preferably the immutable digest above, in untracked production configuration. The cloud checkout has an ignored `infra/terraform/production.auto.tfvars` for this purpose; do not commit plans, state, credentials or secret values. See [the deployment guide](README.md).
