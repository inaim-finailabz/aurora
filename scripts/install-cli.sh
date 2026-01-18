#!/usr/bin/env bash
# Aurora CLI installer script
# This script installs the Aurora CLI to /usr/local/bin or ~/.local/bin
set -euo pipefail

VERSION="0.1.0"
INSTALL_DIR="${HOME}/.local/bin"
FALLBACK_DIR="/usr/local/bin"

# Find the Aurora CLI binary
find_aurora_cli() {
    local locations=(
        # Relative to this script (in installed app)
        "$(dirname "$0")/../MacOS/aurora"
        "$(dirname "$0")/aurora"
        # Inside the app bundle
        "/Applications/Aurora.app/Contents/MacOS/aurora"
        "/Applications/Aurora.app/Contents/Resources/aurora"
        # User provided path
        "$1"
    )

    for loc in "${locations[@]}"; do
        if [[ -f "$loc" && -x "$loc" ]]; then
            echo "$loc"
            return 0
        fi
    done

    return 1
}

# Install the CLI
install_cli() {
    local src="$1"
    local dest_dir="$2"
    local dest="${dest_dir}/aurora"

    # Create destination directory if needed
    mkdir -p "$dest_dir"

    # Copy the binary
    if [[ -w "$dest_dir" ]]; then
        cp "$src" "$dest"
        chmod +x "$dest"
        echo "✓ Installed Aurora CLI to $dest"
    else
        echo "Requesting sudo to install to $dest_dir..."
        sudo cp "$src" "$dest"
        sudo chmod +x "$dest"
        echo "✓ Installed Aurora CLI to $dest"
    fi

    # Add to PATH if needed
    if ! echo "$PATH" | grep -q "$dest_dir"; then
        echo ""
        echo "Add the following to your shell profile (~/.zshrc or ~/.bashrc):"
        echo "  export PATH=\"$dest_dir:\$PATH\""
    fi
}

# Main
main() {
    echo "Aurora CLI Installer v${VERSION}"
    echo "================================"
    echo ""

    local src_path="${1:-}"
    local cli_path

    if cli_path=$(find_aurora_cli "$src_path"); then
        echo "Found Aurora CLI at: $cli_path"
    else
        echo "Error: Aurora CLI binary not found."
        echo ""
        echo "Usage: $0 [/path/to/aurora]"
        echo ""
        echo "If you installed Aurora from DMG:"
        echo "  1. Open Aurora.app from Applications"
        echo "  2. Go to Settings > Install CLI"
        echo ""
        echo "Or manually specify the path to the aurora binary."
        exit 1
    fi

    # Try ~/.local/bin first (no sudo needed)
    if [[ -d "$INSTALL_DIR" ]] || mkdir -p "$INSTALL_DIR" 2>/dev/null; then
        install_cli "$cli_path" "$INSTALL_DIR"
    else
        # Fall back to /usr/local/bin
        install_cli "$cli_path" "$FALLBACK_DIR"
    fi

    echo ""
    echo "Test the installation:"
    echo "  aurora --version"
    echo "  aurora status"
    echo ""
    echo "Commands:"
    echo "  aurora list         - List installed models"
    echo "  aurora pull <repo>  - Pull a model from HuggingFace"
    echo "  aurora search       - Search for GGUF models"
    echo "  aurora chat         - Chat with a model"
    echo "  aurora status       - Check backend status"
}

main "$@"
