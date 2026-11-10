#!/usr/bin/env bash
# Run with the owner's existing project-admin identity. Never transfer keys.
set -euo pipefail
project='freelance-514118'
member='serviceAccount:for-ai-agents@freelance-514118.iam.gserviceaccount.com'
expiry=$(python3 - <<'PY'
from datetime import datetime,timedelta,timezone
print((datetime.now(timezone.utc)+timedelta(hours=2)).strftime('%Y-%m-%dT%H:%M:%SZ'))
PY
)
# Read/copy recovery operations only; no ability to delete the production database.
gcloud projects add-iam-policy-binding "$project" --member="$member" --role='roles/datastore.cloneAdmin' \
 --condition="title=TemporarySecurityRecoveryDrill,expression=request.time < timestamp(\"$expiry\")" --format=none --quiet
# Cleanup permission is separate and can target only temporary drill databases.
role='securityRecoveryDrillCleanup'
task_role_file=$(mktemp)
trap 'rm -f "$task_role_file"' EXIT
if gcloud iam roles describe "$role" --project="$project" --format=json > "$task_role_file"; then
 python3 - "$task_role_file" <<'PY'
import json,sys
r=json.load(open(sys.argv[1]))
assert sorted(r.get('includedPermissions',[]))==['datastore.databases.delete'] and not r.get('deleted') and r.get('stage')!='DISABLED', 'Existing cleanup role differs; review before proceeding.'
PY
else
 gcloud iam roles create "$role" --project="$project" --title='Temporary security recovery cleanup' --permissions='datastore.databases.delete' --stage=GA --format=none --quiet
fi
gcloud projects add-iam-policy-binding "$project" --member="$member" --role="projects/$project/roles/$role" \
 --condition="title=TemporaryDrillDatabaseCleanup,expression=request.time < timestamp(\"$expiry\") && resource.name.startsWith(\"projects/$project/databases/security-restore-drill-\")" --format=none --quiet
printf 'Temporary recovery permissions expire at %s. Production database deletion is not granted.\n' "$expiry"
