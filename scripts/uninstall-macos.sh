#!/usr/bin/env bash
set -euo pipefail

APP_NAME="Aurora.app"
APP_PATH="/Applications/$APP_NAME"
USER_APP_PATH="$HOME/Applications/$APP_NAME"
CONFIG_DIR="$HOME/Library/Application Support/aurora"
PREFS_FILE="$HOME/Library/Preferences/com.finailabz.aurora.plist"
CACHE_DIR="$HOME/Library/Caches/com.finailabz.aurora"
LOG_DIR="$HOME/Library/Logs/aurora"

echo "Removing app bundle..."
rm -rf "$APP_PATH" "$USER_APP_PATH"

echo "Removing app data..."
rm -rf "$CONFIG_DIR" "$PREFS_FILE" "$CACHE_DIR" "$LOG_DIR"

echo "Done."
