# Aurora desktop shell (macOS / Windows / Linux)

This repository now ships Aurora, a Tauri desktop wrapper in `ui/` that runs the FastAPI backend and talks to the bundled llama.cpp server. The goal is an Ollama-like, self-contained experience across platforms from the brain of FinAI Labz (copyright 2026).

## Prereqs
- Python 3.10–3.12 with `pip`.
- Node 18+ (for the Vite/Tauri frontend).
- Rust toolchain (for Tauri). Install via `rustup`.
- Platform llama.cpp `llama-server` binary. Place it in the repo root and set `llama_server_path` accordingly.

## Dev run (from repo root)
```bash
npm install --prefix ui   # or pnpm/yarn in ui
npm run desktop:dev       # spawns backend and opens the desktop window
```

## Build installers
```bash
npm run desktop:tauri
```
Artifacts land in `ui/src-tauri/target/release/bundle` (AppImage/msi/app).

## Backend notes
- The Tauri wrapper spawns `python run.py` (override with `PYTHON_BIN`) with working dir at the repo root.
- API base defaults to `http://127.0.0.1:11435`; change via `VITE_API_BASE`.
- UI pages: Chat/Completion, Installed Models, Pull + HF search, Settings, Logs (SSE).

## Suggested llama-server args per OS
- macOS (Apple Silicon): build with `GGML_METAL=ON`; set `--n-gpu-layers 999 --metal --threads 8`.
- Linux CUDA: build with `-DGGML_CUDA=ON`; args like `--n-gpu-layers 35 --threads 8`.
- Windows CUDA: build with `-DGGML_CUDA=ON` via MSVC; same args as Linux CUDA. For CPU-only, drop GPU flags and keep `--threads N`.
