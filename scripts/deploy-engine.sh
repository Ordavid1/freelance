#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
source deploy/production.env
[[ -f package.json && -f package-lock.json ]] || { echo 'Application source and package-lock.json must be pushed from the laptop first.' >&2; exit 1; }
REVISION="${GITHUB_SHA:-$(git rev-parse HEAD)}"
IMAGE="$REGION-docker.pkg.dev/$PROJECT_ID/$REPOSITORY/engine:$REVISION"
gcloud builds submit . --project="$PROJECT_ID" --config=deploy/cloudbuild.yaml --service-account="projects/$PROJECT_ID/serviceAccounts/freelance-builder@$PROJECT_ID.iam.gserviceaccount.com" --gcs-source-staging-dir="gs://$PROJECT_ID-build-source/source" --substitutions="_IMAGE=$IMAGE" --quiet
# Resolve the built tag once. Releases and rollbacks must identify immutable bytes.
task_digest=$(gcloud artifacts docker images describe "$IMAGE" --project="$PROJECT_ID" --format='value(image_summary.digest)')
[[ "$task_digest" =~ ^sha256:[a-f0-9]{64}$ ]] || { echo 'Could not verify the built image digest.' >&2; exit 1; }
task_release_image="${IMAGE%:*}@$task_digest"
# First creation belongs to Terraform; subsequent releases update the image only.
gcloud run services describe "$SERVICE" --project="$PROJECT_ID" --region="$REGION" >/dev/null || { echo "Initialize Cloud Run with terraform apply -var=engine_image=$task_release_image" >&2; exit 1; }
gcloud run services update "$SERVICE" --project="$PROJECT_ID" --region="$REGION" --image="$task_release_image" --quiet
gcloud run services describe "$SERVICE" --project="$PROJECT_ID" --region="$REGION" --format='value(status.url)'
