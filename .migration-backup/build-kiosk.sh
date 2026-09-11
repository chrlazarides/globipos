#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# GlobiPOS Customer Kiosk — Tauri build pipeline
#
# Usage:
#   ./build-kiosk.sh [target]
#
# Targets:
#   web       Build the PWA only (dist/ folder) — default when Rust not present
#   tauri     Build the Tauri native kiosk binary (requires Rust toolchain)
#   all       Build both
#
# Prerequisites for Tauri build:
#   - Rust toolchain: https://rustup.rs
#   - System WebKit (Linux): libwebkit2gtk-4.1-dev libgtk-3-dev
#   - macOS: Xcode command-line tools
#   - Windows: Visual Studio Build Tools + WebView2
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

TARGET="${1:-web}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$SCRIPT_DIR/customer-app"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  GlobiPOS Customer Kiosk Build"
echo "  Target: $TARGET"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

cd "$APP_DIR"

# ── Step 1: Build the frontend (Vite PWA) ─────────────────────────────────────
build_web() {
  echo ""
  echo "▶ Building Customer PWA (Vite)…"
  if [ ! -d node_modules ]; then
    echo "  Installing dependencies…"
    npm install --legacy-peer-deps
  fi
  npm run build
  echo "✓ PWA built → customer-app/dist/"
}

# ── Step 2: Build the Tauri native binary ────────────────────────────────────
build_tauri() {
  echo ""
  echo "▶ Building Tauri kiosk binary…"
  if ! command -v cargo &>/dev/null; then
    echo "✗ Rust/Cargo not found."
    echo "  Install Rust: curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh"
    exit 1
  fi
  # tauri CLI is in devDependencies — use npx
  npx tauri build
  echo "✓ Kiosk binary built → customer-app/src-tauri/target/release/bundle/"
}

case "$TARGET" in
  web)
    build_web
    ;;
  tauri)
    build_web
    build_tauri
    ;;
  all)
    build_web
    build_tauri
    ;;
  *)
    echo "Unknown target: $TARGET"
    echo "Usage: $0 [web|tauri|all]"
    exit 1
    ;;
esac

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✓ Build complete"

if [ "$TARGET" = "web" ] || [ "$TARGET" = "all" ]; then
  echo ""
  echo "  PWA output:  customer-app/dist/"
  echo "  To serve:    npx serve customer-app/dist -p 4173"
  echo "  Or deploy:   copy dist/ to any static host"
fi

if [ "$TARGET" = "tauri" ] || [ "$TARGET" = "all" ]; then
  echo ""
  echo "  Native bundles:"
  echo "    Linux:   customer-app/src-tauri/target/release/bundle/deb/*.deb"
  echo "    Linux:   customer-app/src-tauri/target/release/bundle/appimage/*.AppImage"
  echo "    macOS:   customer-app/src-tauri/target/release/bundle/macos/*.app"
  echo "    Windows: customer-app/src-tauri/target/release/bundle/msi/*.msi"
fi
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
