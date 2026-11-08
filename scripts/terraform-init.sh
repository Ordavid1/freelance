#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
source deploy/production.env
BUCKET="$PROJECT_ID-terraform-state"
if ! gcloud storage buckets describe "gs://$BUCKET" --project="$PROJECT_ID" >/dev/null 2>&1; then
  gcloud storage buckets create "gs://$BUCKET" --project="$PROJECT_ID" --location="$REGION" --uniform-bucket-level-access --public-access-prevention
fi
gcloud storage buckets update "gs://$BUCKET" --versioning --project="$PROJECT_ID"
terraform -chdir=infra/terraform init -backend-config=backend.hcl
