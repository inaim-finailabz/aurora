#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$ROOT_DIR/ui/src-tauri/target/release/aurora"

if [[ ! -f "$SRC" ]]; then
  echo "Error: missing CLI binary at $SRC"
  echo "Run: (cd ui/src-tauri && cargo build --bin aurora --release)"
  exit 1
fi

TARGET="$(rustc -vV | awk '/^host: /{print $2}')"
if [[ -z "$TARGET" ]]; then
  echo "Error: could not determine rust target triple"
  exit 1
fi

DEST="$ROOT_DIR/ui/src-tauri/aurora-$TARGET"
cp "$SRC" "$DEST"
chmod +x "$DEST"
echo "Prepared sidecar: $DEST"
