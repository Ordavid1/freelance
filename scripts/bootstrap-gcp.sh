#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
scripts/terraform-init.sh
terraform -chdir=infra/terraform plan -out=production.tfplan
terraform -chdir=infra/terraform apply production.tfplan
