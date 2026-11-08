# Legal pages: prepared production release

The Hebrew privacy policy (`/privacy`) and terms (`/terms`) are complete, tested and merged to `main` through [PR #2](https://github.com/Ordavid1/freelance/pull/2). Operator/contact: Or David AI Assimilation Services (Or David), `or@ailead.work`. See [the evidence audit](../docs/legal-data-audit.md).

## Verified image

Cloud Build `ca2e5e97-1aeb-422b-8ee6-7920ccde824c` finished successfully on 8 November 2026. Source commit: `5b6e853d1edc51de4cf20d7126b23b861f33c5b3`; merged application tree: `756f05a664b19365a7860074d2e01b1ed001445f`.

```text
me-west1-docker.pkg.dev/freelance-514118/freelance/engine@sha256:481b531e73dab44273ef7953bc921103a37b9816bf86418a9ff84c2317b860f0
```

Typecheck, production/container builds, Terraform formatting/validation and mobile/desktop browser checks passed. No payment processing is enabled. Google login remains hidden until configured. Social connectors remain conditional on successful Nango/provider setup; producing these legal pages did not certify the external OAuth configuration.

## Administrator step required

The current cloud identity, `for-ai-agents@freelance-514118.iam.gserviceaccount.com`, can build the image and prepare the plan but lacks IAM-policy write permissions for Cloud Run, the build-source bucket and the Nango secret. This is a GCP authorization limitation, not a Codex automatic-approval rejection. No blanket project-owner grant or credential transfer is needed: an existing authorized administrator can apply the reviewed Terraform configuration from their laptop.

The immutable-image plan prepared for this release has **14 additions, 1 update, 0 deletions**. It creates the first Cloud Run service, public invoker binding, external HTTPS load balancer, static IP, managed certificate, redirect and two scoped IAM grants. The update renames the Firebase Web App display name to Freelance Place. No billing-account attachment changes or data-store destruction are planned. Review a fresh plan if infrastructure has changed since preparation; do not reuse a stale binary plan across checkouts or machines.

From a clean checkout of current `main`, using the administrator's existing authorized GCP credentials, Terraform 1.13.5 and the explicit project configuration:

```sh
terraform -chdir=infra/terraform init -backend-config=backend.hcl
terraform -chdir=infra/terraform plan \
  -var='engine_image=me-west1-docker.pkg.dev/freelance-514118/freelance/engine@sha256:481b531e73dab44273ef7953bc921103a37b9816bf86418a9ff84c2317b860f0' \
  -out=legal-release.tfplan
terraform -chdir=infra/terraform show legal-release.tfplan
terraform -chdir=infra/terraform apply legal-release.tfplan
terraform -chdir=infra/terraform output website_dns_records
```

Keep the non-null image setting in untracked production configuration for subsequent plans, as described in [the deployment guide](README.md). Omitting it would propose removing the conditional service/edge resources. Plan and state files are private operational artifacts and must not be committed.

The scoped grants in this configuration are:

- Build-source bucket `freelance-514118-build-source`: `roles/storage.legacyBucketReader` for `freelance-deployer`, in addition to its existing object access. `gcloud builds submit` needs bucket metadata access; object access alone is insufficient.
- Secret `NANGO_API_KEY`: `roles/secretmanager.secretAccessor` for `freelance-runtime`, with secret version 1 referenced by Cloud Run.
- Cloud Run service `freelance-engine`: `roles/run.invoker` for `allUsers`, with ingress restricted to the load balancer and private application actions protected by Firebase sessions.

## DNS and final verification

After Terraform provides the real IP, replace only the Squarespace website records: apex A record to `website_ip_address`, and `www` CNAME to `freelance-place.com`. Preserve email/security TXT, mail records and `_domainconnect`; remove conflicting Squarespace website defaults only. No DNS edit has been made by this legal-page task.

Wait for the managed certificate to become active, then verify both hostnames, the HTTP-to-HTTPS redirect, `/privacy`, `/terms`, footer and contextual links. Verify the account/API access boundaries before treating the whole marketplace as fully validated. The legal routes must load without authentication. Do not report production completion from an image build, merge, pending certificate or Terraform plan alone.

Current outcome: **merged source and successful production image; public deployment remains blocked on the administrator step and subsequent DNS/HTTPS verification.**
