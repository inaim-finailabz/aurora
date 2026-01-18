#!/usr/bin/env bash
set -euo pipefail

APP_ID="aurora"
CONFIG_DIR="$HOME/.config/aurora"
CACHE_DIR="$HOME/.cache/aurora"
DATA_DIR="$HOME/.local/share/aurora"
BIN_DIR="$HOME/.local/bin"

echo "Removing app data..."
rm -rf "$CONFIG_DIR" "$CACHE_DIR" "$DATA_DIR"

if command -v dpkg >/dev/null 2>&1; then
  echo "Attempting to remove Debian package..."
  sudo dpkg -r aurora || true
fi

if command -v apt >/dev/null 2>&1; then
  sudo apt-get remove -y aurora || true
fi

if command -v dnf >/dev/null 2>&1; then
  sudo dnf remove -y aurora || true
fi

if command -v pacman >/dev/null 2>&1; then
  sudo pacman -Rns --noconfirm aurora || true
fi

echo "Removing CLI from user bin (if present)..."
rm -f "$BIN_DIR/aurora"

echo "Done."
