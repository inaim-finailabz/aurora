# Aurora

Aurora is a Tauri + React desktop app for local inference against `llama.cpp`/`llama_cpp_2` models bundled into a Rust sidecar.

## Quickstart

Requirements:
- Node.js 20+, pnpm
- Rust toolchain (install via `rustup`) so the bundled Tauri/Axum backend can compile for your platform
- GGUF-format `llama.cpp` models stored where Aurora can discover them (default `./models`)

Quickstart (binaries):
- Download the latest release for your OS from `https://github.com/inaim-finailabz/aurora/releases`
- macOS: open `Aurora.dmg`, drag Aurora into Applications, and launch
- Windows: run the `.exe` installer
- Linux: install the `.deb` or run the `.AppImage`

Install & run (development):

```bash
# from repo root
pnpm --prefix ui install
pnpm --prefix ui run dev
# or for desktop dev
pnpm run desktop:dev
```

## Architecture
- UI: `ui/` is a Vite + React SPA that communicates with the Rust backend via Axios.
- Backend: `ui/src-tauri` houses the Tauri/Rust server that uses `llama_cpp_2` to load GGUF models, serve `/api/*` endpoints, and power the CLI/terminal panels. No Python runtime is required anymore.

Build and create platform bundles:

```bash
pnpm --prefix ui run build
pnpm --prefix ui run tauri -- build
```

Releases are automated via GitHub Actions: see `.github/workflows/release.yml` and `RELEASES.md`.

## Downloads
- GitHub Releases (all platforms): `https://github.com/inaim-finailabz/aurora/releases`
- macOS DMG: `Aurora_*.dmg`
- Windows installers: `.msi` and `.exe`
- Linux packages: `.deb` and `.AppImage`

## CLI (aurora)

The `aurora` CLI is packaged as a standalone binary for macOS, Windows, and Linux. To use it from any terminal, add the binary to your PATH.

macOS / Linux:
```bash
# after extracting the release archive
./scripts/install-cli.sh /path/to/aurora
```

Windows (PowerShell, admin):
```powershell
.\scripts\install-cli.ps1 -Source "C:\path\to\aurora.exe"
```

Windows (PowerShell, user-only):
```powershell
.\scripts\install-cli-user.ps1 -Source "C:\path\to\aurora.exe"
```

Verify:
```bash
aurora status
aurora pull TheBloke/Llama-2-7B-GGUF:Q4_K_M
```

## Uninstall scripts

macOS:
```bash
./scripts/uninstall-macos.sh
```

Linux:
```bash
./scripts/uninstall-linux.sh
```

Windows (PowerShell):
```powershell
.\scripts\uninstall-windows.ps1
```

### Platform-specific builds

Local builds are expected to run on the target OS (cross-compilation is not configured).

macOS:
- Prereqs: Xcode Command Line Tools (`xcode-select --install`)
- App bundle: `pnpm --prefix ui run build`
- CLI binary: `cd ui/src-tauri && cargo build --bin aurora --release`
- Prepare CLI sidecar for the app bundle: `./scripts/prepare-sidecar.sh`
- Output: `ui/src-tauri/target/release/bundle/macos/Aurora.app`

Windows:
- Prereqs: Visual Studio Build Tools + Windows SDK (MSVC), Node.js 20+, pnpm, Rust
- App installers: `pnpm --prefix ui run build`
- CLI binary: `cd ui/src-tauri && cargo build --bin aurora --release`
- Prepare CLI sidecar for the installers: `.\scripts\prepare-sidecar.ps1`
- Output: `ui/src-tauri/target/release/bundle/msi/*.msi` and `ui/src-tauri/target/release/bundle/nsis/*.exe`

Linux (Ubuntu/Debian):
- Prereqs: `sudo apt-get install -y libgtk-3-dev libwebkit2gtk-4.0-dev libappindicator3-dev librsvg2-dev patchelf`
- App bundles: `pnpm --prefix ui run build`
- CLI binary: `cd ui/src-tauri && cargo build --bin aurora --release`
- Prepare CLI sidecar for the installers: `./scripts/prepare-sidecar.sh`
- Output: `ui/src-tauri/target/release/bundle/deb/*.deb` and `ui/src-tauri/target/release/bundle/appimage/*.AppImage`

Note: `ui/src-tauri/tauri.conf.json` includes installer targets for Windows and Linux and bundles the CLI as a sidecar via `externalBin`. If the `aurora-<target-triple>` sidecar file is missing, the Tauri bundle step will fail — run the prepare script above or remove `externalBin` when you don’t need the CLI bundled.

## Contributing
Please read `CONTRIBUTING.md` for contribution guidelines.
## License

**Dual License Model:**

- **Pre-built Binaries** (GitHub Releases): Licensed under the **MIT License** (`LICENSE-BINARIES`). You are free to use, distribute, and modify the binaries for any purpose, including commercial use.

- **Source Code**: Licensed under the **PolyForm Noncommercial License 1.0.0** (`LICENSE`, `LICENSE-NONCOMMERCIAL.md`). You may use, copy, and modify the source code for non-commercial purposes only. Commercial use of the source code is prohibited without obtaining a separate commercial license from FinAI Labz.

For commercial licensing inquiries, see `LICENSE-FAQ.md` or contact licensing@finailabz.com.

## Contact & Social
- GitHub: https://github.com/inaim-finailabz
- Licensing: licensing@finailabz.com

## Theme

Aurora defaults to **light** theme. You can toggle between dark, light, and system modes using the theme button in the chat header. Your preference is saved in `localStorage` as `aurora_theme`. When `system` is selected Aurora follows your OS theme and updates automatically.
