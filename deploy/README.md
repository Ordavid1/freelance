# Production deployment

Target: `Ordavid1/freelance`, GCP `freelance-514118`, Cloud Run `freelance-engine` in `me-west1`; canonical host `freelance-place.com`.

## Source, credentials, and Terraform state

The Next.js application and deployment infrastructure belong to this repository. Do not recopy over the checkout from the original laptop workspace. Commit `.env.example` only; never commit local `.env` files, credentials, generated output, `node_modules`, Terraform state, plans, or variable files. `.gitignore`, `.dockerignore`, and `.gcloudignore` cover these local inputs.

Use an authorized GCP identity and specify project `freelance-514118`; the shell's default project may differ. Never copy a service-account key into the repository or chat. Terraform 1.13.5, Google provider versions, and checksums are pinned. Remote state is `freelance-514118-terraform-state/production`, with versioning, uniform access, and public access prevention. Treat state as sensitive.

```sh
scripts/install-terraform.sh
export PATH="$HOME/.local/bin:$PATH"
scripts/terraform-init.sh
terraform -chdir=infra/terraform plan -var='engine_image=IMAGE_DIGEST_URI' -out=production.tfplan
# Inspect the complete plan before applying it.
terraform -chdir=infra/terraform apply production.tfplan
```

Use a non-null immutable image digest in every production plan. Omitting `engine_image` plans to remove the service and dependent website resources; Cloud Run deletion protection blocks service deletion.

## Runtime and public edge

Terraform manages runtime/build/deployment identities, IAM, APIs, Artifact Registry, the build-source bucket, GitHub OIDC, Firebase/Firestore/storage resources, Cloud Run, and the public edge. Cloud Run accepts traffic through a global external HTTPS load balancer, whose frontend has a Google-managed certificate and HTTP-to-HTTPS redirect. The load balancer and `allUsers` Cloud Run invoker binding are conditional on the first image. Application APIs still enforce Firebase sessions and per-user authorization.

Cloud Run domain mapping is not available in `me-west1`. The external load balancer is configured for both `freelance-place.com` and `www.freelance-place.com`. After applying the first image, read `website_ip_address` and `website_dns_records` from Terraform outputs. In Squarespace, replace only the existing Squarespace website records with apex `A @ → website_ip_address` and `CNAME www → freelance-place.com`; retain `_domainconnect` and email records. The managed TLS certificate stays pending until DNS resolves to the load-balancer IP.

The current checkout has no first image or Cloud Run service, so no IP exists and no Squarespace record should be changed yet. The DNS page was inspected and currently has Squarespace defaults at `@` and `www`; its separate email-security records must remain intact.

## First release requirements

Before publishing a release, finish OAuth setup: configure Google Identity Platform with the owner's OAuth client; configure Nango GitHub/LinkedIn integrations and `NANGO_API_KEY` in Secret Manager; and configure the Dribbble app with the deployed callback URI, client ID, and a rotated client secret in Secret Manager. Dribbble uses only the `public` scope and is handled directly by the app. Do not put OAuth secrets in Terraform variables, Git, the browser, or chat. Verify the canonical host in Google Identity Platform's authorized domains.

1. Run `npm ci`, `npm run typecheck`, and `npm run build`; build the container with `deploy/engine.Dockerfile`.
2. Build an immutable image with `scripts/deploy-engine.sh` (its first run prints the Terraform initialization command).
3. Apply the reviewed Terraform plan with `engine_image=IMAGE_DIGEST_URI`; inspect the public invoker and load-balancer resources in the plan.
4. Add the Terraform DNS records in Squarespace, then wait for the managed certificate.
5. Verify sign-in, data ownership, profile save, private uploads/deletion, social authorization/import/disconnect, Vertex requests, and logs on both hostnames.
6. Only push to `main` after release approval. `.github/workflows/deploy.yml` can update production on main-branch pushes.

The current product does not provide durable conversations, freelancer discovery, or billing. Membership stays in demo/non-billing state; do not represent it as charged or active. The GCP billing account attachment is not managed by this Terraform configuration.

## Operations

Use `gcloud run revisions list --service=freelance-engine --region=me-west1 --project=freelance-514118` and `gcloud run services update-traffic` for rollback. Inspect Cloud Logging for build/runtime failures. The service starts at zero and caps at five instances with 1 CPU and 512 MiB each. Build sources expire after seven days. Set uptime checks and alert destinations after launch ownership is established.
