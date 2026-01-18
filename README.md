# Aurora

Aurora is a Tauri + React desktop app for local and cloud inference.

## Quickstart

Requirements:
- Node.js 20+, pnpm
- Rust & Cargo
- Python 3.10+ (for the backend)

Install & run (development):

```bash
# from repo root
pnpm --prefix ui install
pnpm --prefix ui run dev
# or for desktop dev
pnpm run desktop:dev
```

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