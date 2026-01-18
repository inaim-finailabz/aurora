#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: ./scripts/install-cli.sh /path/to/aurora"
  exit 1
fi

SRC="$1"
DEST="/usr/local/bin/aurora"

if [[ ! -f "$SRC" ]]; then
  echo "Error: file not found: $SRC"
  exit 1
fi

chmod +x "$SRC"
sudo install -m 0755 "$SRC" "$DEST"
echo "Installed aurora to $DEST"
