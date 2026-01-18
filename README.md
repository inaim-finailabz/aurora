# Aurora

Aurora is a Tauri + React desktop app for local inference against `llama.cpp`/`llama_cpp_2` models bundled into a Rust sidecar.

## Quickstart

Requirements:
- Node.js 20+, pnpm
- Rust toolchain (install via `rustup`) so the bundled Tauri/Axum backend can compile for your platform
- GGUF-format `llama.cpp` models stored where Aurora can discover them (default `./models`)

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

## Contributing
Please read `CONTRIBUTING.md` for contribution guidelines.
## License

This project is licensed under the **PolyForm Noncommercial License 1.0.0**. You may use, copy, and modify the code for non-commercial purposes only. Commercial use is prohibited without obtaining a separate commercial license from FinAI Labz. See the `LICENSE` file for details. For commercial licensing requests, see `LICENSE-FAQ.md` for contact information and example pricing tiers.

## Theme

Aurora defaults to **light** theme. You can toggle between dark, light, and system modes using the theme button in the chat header. Your preference is saved in `localStorage` as `aurora_theme`. When `system` is selected Aurora follows your OS theme and updates automatically.
