#!/usr/bin/env bash
# Run with an existing project administrator's gcloud identity.
# Never run by transferring an administrator credential to the cloud agent.
set -euo pipefail

task_project='freelance-514118'
task_member='serviceAccount:for-ai-agents@freelance-514118.iam.gserviceaccount.com'
task_tmp=$(mktemp -d)
trap 'rm -rf "$task_tmp"' EXIT

command -v gcloud >/dev/null
command -v python3 >/dev/null

ensure_role() {
  local role_id="$1" title="$2" permissions="$3"
  if gcloud iam roles describe "$role_id" --project="$task_project" --format=json > "$task_tmp/role.json" 2> "$task_tmp/role-error"; then
    # Refuse to broaden or overwrite a preexisting role with different contents.
    python3 - "$task_tmp/role.json" "$permissions" <<'PY'
import json, sys
with open(sys.argv[1]) as source:
    role = json.load(source)
if role.get('deleted') or role.get('stage') == 'DISABLED' or sorted(role.get('includedPermissions', [])) != sorted(sys.argv[2].split(',')):
    raise SystemExit('Existing release IAM role differs from the expected definition; review it before proceeding.')
PY
  elif grep -q 'NOT_FOUND' "$task_tmp/role-error"; then
    gcloud iam roles create "$role_id" --project="$task_project" \
      --title="$title" --stage=GA --permissions="$permissions" --quiet
  else
    cat "$task_tmp/role-error" >&2
    return 1
  fi
}

ensure_role 'freelanceReleaseDataIam' 'Freelance release data IAM' \
  'storage.buckets.getIamPolicy,storage.buckets.setIamPolicy,secretmanager.secrets.getIamPolicy,secretmanager.secrets.setIamPolicy'
ensure_role 'freelanceReleaseRunIam' 'Freelance release Cloud Run IAM' \
  'run.services.getIamPolicy,run.services.setIamPolicy'

# Newly created custom roles can be readable in IAM before Cloud Storage
# recognizes them. Retry only that propagation error, never permission denials.
grant_with_role_propagation_retry() {
  local attempt
  for attempt in {1..12}; do
    if "$@" > "$task_tmp/binding.log" 2>&1; then
      cat "$task_tmp/binding.log"
      return 0
    fi
    if ! grep -Fq "does not exist in the resource's hierarchy" "$task_tmp/binding.log" || [[ "$attempt" -eq 12 ]]; then
      cat "$task_tmp/binding.log" >&2
      return 1
    fi
    printf 'Waiting for the new custom role to propagate; retry %s/12 in 20 seconds.\n' "$attempt" >&2
    sleep 20
  done
}

# These bindings apply only to the named source bucket and Nango secret.
# They do not themselves grant access to secret payloads or stored objects.
grant_with_role_propagation_retry gcloud storage buckets add-iam-policy-binding 'gs://freelance-514118-build-source' \
  --project="$task_project" --member="$task_member" \
  --role="projects/$task_project/roles/freelanceReleaseDataIam" --quiet
grant_with_role_propagation_retry gcloud secrets add-iam-policy-binding 'NANGO_API_KEY' \
  --project="$task_project" --member="$task_member" \
  --role="projects/$task_project/roles/freelanceReleaseDataIam" --condition=None --quiet

# The service does not exist yet, so a service-level binding cannot be added.
# Limit the project-level bootstrap grant to two Cloud Run policy permissions
# and two hours. No project IAM-policy permission is granted to the agent.
task_expiry=$(python3 - <<'PY'
from datetime import datetime, timedelta, timezone
print((datetime.now(timezone.utc) + timedelta(hours=2)).strftime('%Y-%m-%dT%H:%M:%SZ'))
PY
)
grant_with_role_propagation_retry gcloud projects add-iam-policy-binding "$task_project" \
  --member="$task_member" \
  --role="projects/$task_project/roles/freelanceReleaseRunIam" \
  --condition="expression=request.time < timestamp(\"$task_expiry\"),title=FreelanceReleaseRunIamBootstrap,description=Two-hour first-release Cloud Run IAM bootstrap" \
  --quiet

printf 'Release IAM grants applied. Cloud Run IAM bootstrap expires at %s.\n' "$task_expiry"
printf 'Tell the cloud chat the grants are ready so it can resume the release.\n'
