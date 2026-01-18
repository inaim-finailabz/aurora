# Aurora desktop shell (macOS / Windows / Linux)

This repository now ships Aurora as a Tauri desktop wrapper in `ui/`. The UI is a Vite + React SPA that talks to the Rust/Axum sidecar living in `ui/src-tauri`, which loads GGUF-format `llama.cpp` models via the [`llama_cpp_2`](https://docs.rs/llama_cpp_2) crate. No external Python or `llama-server` binary is required—the inference engine runs in-process with the desktop bundle.

## Prereqs
- Node.js 20+ and pnpm (or npm/yarn) for the Vite/Tauri frontend.
- Rust toolchain (install via `rustup`) so Cargo can compile the backend for your current platform; add extra targets (`x86_64-apple-darwin`, `x86_64-pc-windows-msvc`, `x86_64-unknown-linux-gnu`, etc.) if you plan to cross-build installers.
- GGUF-format `llama.cpp` models in Aurora's storage directory (default `./models`). The app discovers models automatically and keeps metadata under `config.yaml` + `models/models.json`.

## Dev run (from repo root)
```bash
pnpm --prefix ui install
pnpm run desktop:dev
```

## Build installers
```bash
pnpm run desktop:tauri
```
Artifacts land in `ui/src-tauri/target/release/bundle` (AppImage/msi/app) and are produced per the host OS; install the matching Rust targets before cross-building for other platforms.

## Backend notes
- The Rust/Axum server (`ui/src-tauri/src/main.rs`) is spawned automatically by Tauri, listens on `http://127.0.0.1:11435`, and keeps inference state in-process through `llama_cpp_2`. Configuration is persisted to the user's config dir (`~/.config/aurora/config.json`) for storage paths, defaults, and registry entries.
- `VITE_API_BASE` can override the frontend-to-backend base URL if needed (e.g., remote testing).
- The UI panels—Chat, Completion, Installed Models, Pull/Search, Settings, Logs, and the terminal-style CLI—talk to `/api/*` endpoints served by the Rust backend. The CLI panel's commands are all implemented client-side and ship with the desktop bundle.
