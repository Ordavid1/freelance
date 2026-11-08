#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
VERSION=$(cat .terraform-version)
OS=$(uname -s | tr '[:upper:]' '[:lower:]')
case "$(uname -m)" in x86_64) ARCH=amd64 ;; arm64|aarch64) ARCH=arm64 ;; *) echo 'Unsupported architecture' >&2; exit 1 ;; esac
DEST="${TERRAFORM_INSTALL_DIR:-$HOME/.local/bin}"
TEMP=$(mktemp -d)
trap 'rm -rf "$TEMP"' EXIT
ARCHIVE="terraform_${VERSION}_${OS}_${ARCH}.zip"
curl -fsS "https://releases.hashicorp.com/terraform/$VERSION/$ARCHIVE" -o "$TEMP/$ARCHIVE"
curl -fsS "https://releases.hashicorp.com/terraform/$VERSION/terraform_${VERSION}_SHA256SUMS" -o "$TEMP/SHA256SUMS"
python3 - "$TEMP" "$ARCHIVE" "$DEST" <<'PY'
import hashlib,pathlib,sys,zipfile
root,archive,dest=map(pathlib.Path,sys.argv[1:])
expected=next(line.split()[0] for line in (root/'SHA256SUMS').read_text().splitlines() if line.endswith(str(archive)))
assert hashlib.sha256((root/archive).read_bytes()).hexdigest()==expected, 'Checksum mismatch'
dest.mkdir(parents=True,exist_ok=True)
with zipfile.ZipFile(root/archive) as z: z.extract('terraform',dest)
(dest/'terraform').chmod(0o755)
print('Installed:',dest/'terraform')
PY
"$DEST/terraform" version
