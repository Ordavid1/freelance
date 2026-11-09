#!/usr/bin/env bash
# Produces a saved infrastructure plan only. Never applies or deploys an image.
set -euo pipefail
cd "$(dirname "$0")/.."
root="$PWD"
config="${1:-deploy/cardcom.generated.tfvars.json}"
[[ "$config" = /* ]] || config="$root/$config"
[[ -f "$config" ]] || { echo 'Generate the references-only Cardcom config first.' >&2; exit 1; }
python3 - "$config" <<'PY'
import json,sys
config=json.load(open(sys.argv[1]))
if config.get('billing_enabled') is not False:
    raise SystemExit('Preparation plan requires billing_enabled=false. Activation is a separate rollout step.')
if not config.get('engine_image'):
    raise SystemExit('Missing current engine_image; use prepare-cardcom.mjs to preserve the existing service.')
for field in ['CARDCOM_TERMINAL_NUMBER','CARDCOM_API_NAME']:
    ref=config.get('cardcom_secrets',{}).get(field,{})
    if not ref.get('project') or not ref.get('name') or not str(ref.get('version','')).isdigit():
        raise SystemExit('Missing a pinned Cardcom secret reference.')
PY
terraform -chdir=infra/terraform init -input=false -reconfigure -backend-config=backend.hcl
terraform -chdir=infra/terraform validate
terraform -chdir=infra/terraform plan -input=false -var-file="$config" -out=cardcom-preparation.tfplan
