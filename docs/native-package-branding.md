# Native package branding verification

Source configuration is not proof of an installer's branding. The native release
workflow runs `scripts/pos_packaged_branding.py` on actual trusted build output:

- **Windows:** reads PE group/icon resources in NSIS setup; silently installs into
  an isolated temporary directory and checks the application and generated
  uninstaller. MSI administrative extraction checks the packaged application.
- **macOS:** mounts each DMG read-only, reads the bundle's selected icon from
  `Info.plist`, and compares the packaged ICNS.
- **Linux:** extracts each DEB/AppImage and checks desktop launcher references,
  packaged PNG pixels and the AppImage `.DirIcon`. Unexpected SVG overrides fail.
- **Android:** decodes every signed ABI APK with apktool, checks manifest
  references, all density/round/foreground pixels, adaptive XML and background
  colour. Unrecognised launcher overrides fail rather than silently passing.

PNG comparisons use decoded RGBA pixels, allowing APK compression changes without
accepting different artwork. Windows frame and macOS ICNS comparisons use actual
packaged bytes from the runner's freshly regenerated approved product icons.

Each platform produces an inspection report with the SHA-256 of every inspected
installer and the surfaces checked. The final release check downloads the published
packages and requires them to match those reports from the **same workflow run**.
Reports are build evidence, not independently signed attestations.

## Local regression checks

```sh
python -m pip install -r scripts/pos-branding-requirements.txt
python -m unittest discover -s scripts -p 'pos_packaged_branding_test.py'
node --test scripts/pos-branding.test.mjs scripts/pos-release-branding.test.mjs scripts/verify-pos-release.test.mjs
```

These fixtures test extraction and rejection of substituted icons. They are not
proof that a new native release has been built successfully. OS-specific extraction
commands must run on their respective GitHub runners. Run the package CLI only
against trusted build output: Windows installers and AppImages are executed during
inspection. Android inspection additionally needs Java and apktool.

## Published release checks

Download all four `branding-*` artifacts from the release's GitHub workflow run.
Place their JSON files together in `branding-reports/`:

```sh
node scripts/verify-pos-release.mjs chrlazarides/globipos latest --branding-reports branding-reports
```

A missing platform, missing surface, uninspected APK/installer, failed download or
changed binary fails explicitly. To check inventory/updater metadata without
claiming package branding was checked:

```sh
node scripts/verify-pos-release.mjs chrlazarides/globipos latest --metadata-only
```

Desktop packages are currently uploaded by the existing Tauri action before their
inspection step; the final release job is the readiness gate, not an atomic
publication barrier. If it fails, some assets can already be public. Do not
advertise the release as ready or bypass the failed checks.

Adding these checks does not push, tag, change signing identities, or publish a
release. Existing downloaded installers remain unchanged until a new authorised
native release is built and passes these checks.