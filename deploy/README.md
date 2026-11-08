# Production deployment

Target: `Ordavid1/freelance`, GCP `freelance-514118`, Cloud Run `freelance-engine` in `me-west1`.

## Current source boundary

This repository initially contained only a README. The existing Freelance Zone Next.js application lives on the laptop at `/Users/ordavid/Documents/Codex/2026-11-08/can-you-access-my-open-laptop` in the chat **Access xplace.co.il in Chrome**. Copy its application files (including package.json and package-lock.json) here, preserving this deployment directory and infrastructure files. Do not copy `.env`, `.next`, credentials or node_modules. The container recipe must be verified against that source before the first release. No replacement application or live engine has been invented.

## Tools and authentication

Install Google Cloud CLI and run `gcloud auth login` and `gcloud auth application-default login` as a project administrator. In a managed environment, use its configured credential file without copying a key into this repository.

```sh
scripts/install-terraform.sh
export PATH="$HOME/.local/bin:$PATH"
scripts/terraform-init.sh
terraform -chdir=infra/terraform plan -out=production.tfplan
terraform -chdir=infra/terraform apply production.tfplan
```

Terraform 1.13.5 is pinned in `.terraform-version`; Google provider versions and checksums are locked. GCS remote state uses `freelance-514118-terraform-state/production`, uniform bucket access, public access prevention, versioning and Terraform state locking. Treat state as sensitive; never commit it. This bootstrap bucket is deliberately outside application state so infrastructure destruction cannot delete its own state.

Initial infrastructure application needs project IAM policy administration, service-account and workload identity administration, Service Usage administration, Artifact Registry administration and Storage administration. Creating Cloud Run also needs Cloud Run administration and permission to act as its runtime service account. The configured `for-ai-agents` account can create resources but received `Policy update access denied` on project `setIamPolicy`. A project IAM administrator must grant the intended roles or run the reviewed Terraform plan.

## Ownership

Terraform manages APIs, runtime/build/deployment identities and scoped permissions, Artifact Registry, a short-lived build source bucket, GitHub OIDC federation and the initial Cloud Run service. Its import blocks adopt the 12 resources created during bootstrap. Terraform never disables project APIs on destruction. Cloud Run has deletion protection and is private by default. Do not expose the app until its authentication, AI routes and URL import behavior have been reviewed.

GitHub OIDC is restricted to repository ID 1450584138, owner ID 43148515, main branch and push/manual events. No service-account key is stored in GitHub. GitHub handles image releases; Terraform ignores only the container image and gcloud client metadata. Apply infrastructure manually with administrator credentials; the CI deployer is not an infrastructure administrator.

## First application release

After source transfer, inspect `src/lib/ai.ts` and the Vertex API routes to confirm environment variable names, supported model/location and access controls. The baseline supplies `GOOGLE_CLOUD_PROJECT` and `GOOGLE_CLOUD_LOCATION=global`, plus runtime Application Default Credentials with Vertex access. Add any app-specific nonsecret variables to Terraform and secret references via Secret Manager if needed.

1. Run `npm ci` and `npm run build`; test the app and container using `deploy/engine.Dockerfile`.
2. Build the first image using `gcloud builds submit` with `deploy/cloudbuild.yaml`, `_IMAGE=me-west1-docker.pkg.dev/freelance-514118/freelance/engine:COMMIT_SHA`, the dedicated build service account and `gs://freelance-514118-build-source/source` staging bucket (see `scripts/deploy-engine.sh` for full arguments).
3. Run `terraform -chdir=infra/terraform plan -var='engine_image=IMAGE_URI' -out=production.tfplan`, review, then apply. Keep the non-null `engine_image` value in an untracked production `.tfvars` file on future plans; removing it would plan removal of the service, blocked by deletion protection. Prefer an immutable digest.
4. Smoke-test the private Cloud Run URL with an authorized invoker identity; verify key pages, profile generation, project drafting, logs and error handling.
5. Push subsequent application changes to `main`; `.github/workflows/deploy.yml` builds and deploys them using OIDC. Until source is present, deployment is explicitly skipped.

The current app history identifies prototype limitations: real authentication, persistent accounts/storage, messaging and billing are not established. Infrastructure setup does not make these features production-ready. Add data services based on the actual schema and application behavior rather than creating speculative databases.

## Rollback and operations

Use `gcloud run revisions list --service=freelance-engine --region=me-west1 --project=freelance-514118` and route traffic to a previously verified revision with `gcloud run services update-traffic`. Inspect Cloud Logging for build and runtime failures. Cloud Run starts at zero instances and is capped at five, with 1 CPU and 512 MiB per instance; adjust from measured load. GCS build sources expire after seven days. Configure uptime checks and an alert notification destination after the authenticated production endpoint and owner destination are established.
