#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# GlobiPOS Terminal — local native build script (macOS / Linux)
# Run this on your own Mac or Linux machine to compile the Tauri app.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
POS_APP_DIR="$ROOT_DIR/pos-app"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
info()    { echo -e "${BLUE}[INFO]${NC}  $*"; }
success() { echo -e "${GREEN}[OK]${NC}    $*"; }
warn()    { echo -e "${YELLOW}[WARN]${NC}  $*"; }
error()   { echo -e "${RED}[ERROR]${NC} $*" >&2; exit 1; }

echo ""
echo "  ╔══════════════════════════════════════════════╗"
echo "  ║     GlobiPOS Terminal — Native Build         ║"
echo "  ╚══════════════════════════════════════════════╝"
echo ""

# ── 1. Check prerequisites ────────────────────────────────────────────────────
info "Checking prerequisites…"

command -v node >/dev/null 2>&1 || error "Node.js not found. Install from https://nodejs.org (v20 LTS recommended)"
command -v npm  >/dev/null 2>&1 || error "npm not found (comes with Node.js)"
command -v rustc >/dev/null 2>&1 || {
  warn "Rust not found. Installing via rustup…"
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
  # shellcheck disable=SC1090
  source "$HOME/.cargo/env"
}

NODE_VER=$(node --version)
RUST_VER=$(rustc --version)
success "Node.js $NODE_VER"
success "$RUST_VER"

OS=$(uname -s)
ARCH=$(uname -m)
info "Platform: $OS $ARCH"

# macOS: check for Xcode CLT
if [[ "$OS" == "Darwin" ]]; then
  if ! xcode-select -p &>/dev/null; then
    warn "Xcode Command Line Tools not found. Installing…"
    xcode-select --install
    echo "  After the installer finishes, re-run this script."
    exit 0
  fi
  success "Xcode CLT found"

  # Universal binary targets
  if [[ "$ARCH" == "arm64" ]]; then
    rustup target add x86_64-apple-darwin aarch64-apple-darwin 2>/dev/null || true
    BUILD_ARGS="--target universal-apple-darwin"
  else
    rustup target add aarch64-apple-darwin 2>/dev/null || true
    BUILD_ARGS="--target universal-apple-darwin"
  fi

# Linux: install system dependencies
elif [[ "$OS" == "Linux" ]]; then
  if command -v apt-get >/dev/null 2>&1; then
    info "Installing Linux build dependencies…"
    sudo apt-get update -qq
    sudo apt-get install -y -qq \
      libwebkit2gtk-4.1-dev \
      libappindicator3-dev \
      librsvg2-dev \
      patchelf \
      libxdo-dev \
      libssl-dev \
      build-essential \
      curl \
      wget \
      file \
      libgtk-3-dev
    success "System dependencies installed"
  elif command -v dnf >/dev/null 2>&1; then
    sudo dnf install -y webkit2gtk4.1-devel openssl-devel libappindicator-gtk3-devel librsvg2-devel
  fi
  BUILD_ARGS=""
fi

# ── 2. Check pos-app directory ────────────────────────────────────────────────
[[ -d "$POS_APP_DIR" ]] || error "pos-app directory not found at $POS_APP_DIR"
[[ -f "$POS_APP_DIR/package.json" ]] || error "pos-app/package.json not found"
[[ -d "$POS_APP_DIR/src-tauri" ]] || error "pos-app/src-tauri not found"

# ── 3. Install frontend dependencies ─────────────────────────────────────────
info "Installing frontend dependencies…"
cd "$POS_APP_DIR"
npm ci --prefer-offline 2>/dev/null || npm install
success "npm dependencies ready"

# ── 4. Build ──────────────────────────────────────────────────────────────────
info "Building GlobiPOS Terminal (this takes 3–8 minutes on first build)…"
info "Rust will compile ~200 crates — subsequent builds are much faster."
echo ""

if [[ "$OS" == "Darwin" ]]; then
  npx tauri build -- $BUILD_ARGS
else
  npx tauri build
fi

# ── 5. Show output ────────────────────────────────────────────────────────────
echo ""
echo "  ══════════════════════════════════════════════"
success "Build complete!"
echo ""

if [[ "$OS" == "Darwin" ]]; then
  DMG=$(find "$POS_APP_DIR/src-tauri/target" -name "*.dmg" 2>/dev/null | head -1)
  [[ -n "$DMG" ]] && echo "  DMG: $DMG"
elif [[ "$OS" == "Linux" ]]; then
  APPIMAGE=$(find "$POS_APP_DIR/src-tauri/target" -name "*.AppImage" 2>/dev/null | head -1)
  DEB=$(find "$POS_APP_DIR/src-tauri/target" -name "*.deb" 2>/dev/null | head -1)
  [[ -n "$APPIMAGE" ]] && echo "  AppImage : $APPIMAGE"
  [[ -n "$DEB" ]]      && echo "  DEB      : $DEB"
fi

echo ""
echo "  Install the file above, then:"
echo "  1. Launch GlobiPOS Terminal"
echo "  2. Enter your server URL"
echo "  3. Enter your terminal code (e.g. T001)"
echo "  4. Tap Register — the app is ready."
echo "  ══════════════════════════════════════════════"
