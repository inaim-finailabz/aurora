# Release automation & uploading binaries (GitHub Releases)

This project includes a GitHub Actions workflow at `.github/workflows/release.yml` that builds platform bundles and uploads them to a GitHub Release when you push a tag like `v0.1.0` or run the workflow manually.

Quick steps to create a release:

1. Create a semver tag locally and push it:

   ```bash
   git tag v0.1.0 -m "Release v0.1.0"
   git push origin v0.1.0
   ```

2. The workflow will run on GitHub and upload built bundles to the created Release.

Important notes & signing:

- The workflow builds on `ubuntu-latest`, `windows-latest`, and `macos-latest`. For signed installers and notarization you must provide signing credentials as repository secrets. Common secrets:
  - `APPLE_ID` and `APP_SPECIFIC_PASSWORD` (for notarization)
  - `MACOS_SIGNING_KEY` / `MACOS_SIGNING_KEY_PASSWORD` (if using a custom P12)
  - `WINDOWS_PFX` and `WINDOWS_PFX_PASSWORD` (for code signing on Windows)

- Currently the workflow uploads unsigned installers. Add signing steps in the build jobs if you require signed artifacts.

- If a build fails on a runner, inspect the job logs in the Actions tab for details.

If you want, I can:
- Add signing + notarization steps (you'll need to provide or store secrets), or
- Add an extra job to publish the release to an external CDN or S3 bucket.

Which of these would you like me to add next?