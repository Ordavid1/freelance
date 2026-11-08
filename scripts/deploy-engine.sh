#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
source deploy/production.env
[[ -f package.json && -f package-lock.json ]] || { echo 'Application source and package-lock.json must be pushed from the laptop first.' >&2; exit 1; }
REVISION="${GITHUB_SHA:-$(git rev-parse HEAD)}"
IMAGE="$REGION-docker.pkg.dev/$PROJECT_ID/$REPOSITORY/engine:$REVISION"
gcloud builds submit . --project="$PROJECT_ID" --config=deploy/cloudbuild.yaml --service-account="projects/$PROJECT_ID/serviceAccounts/freelance-builder@$PROJECT_ID.iam.gserviceaccount.com" --gcs-source-staging-dir="gs://$PROJECT_ID-build-source/source" --substitutions="_IMAGE=$IMAGE" --quiet
# First creation belongs to Terraform; subsequent releases update the image only.
gcloud run services describe "$SERVICE" --project="$PROJECT_ID" --region="$REGION" >/dev/null || { echo "Initialize Cloud Run with terraform apply -var=engine_image=$IMAGE" >&2; exit 1; }
gcloud run services update "$SERVICE" --project="$PROJECT_ID" --region="$REGION" --image="$IMAGE" --quiet
gcloud run services describe "$SERVICE" --project="$PROJECT_ID" --region="$REGION" --format='value(status.url)'
