# ─────────────────────────────────────────────────────────────────────────────
# GlobiPOS Terminal — local native build script (Windows PowerShell)
# Run this on your Windows 10/11 machine to compile the Tauri app.
# Open PowerShell as Administrator, then run:  .\scripts\build-native.ps1
# ─────────────────────────────────────────────────────────────────────────────
param(
  [switch]$SkipPrereqs,
  [switch]$Clean
)

$ErrorActionPreference = "Stop"
$ScriptDir  = Split-Path -Parent $MyInvocation.MyCommand.Definition
$RootDir    = Split-Path -Parent $ScriptDir
$PosAppDir  = Join-Path $RootDir "pos-app"

function Write-Info    { param($m) Write-Host "[INFO]  $m" -ForegroundColor Cyan }
function Write-Success { param($m) Write-Host "[OK]    $m" -ForegroundColor Green }
function Write-Warn    { param($m) Write-Host "[WARN]  $m" -ForegroundColor Yellow }
function Write-Fail    { param($m) Write-Host "[ERROR] $m" -ForegroundColor Red; exit 1 }

Write-Host ""
Write-Host "  ╔══════════════════════════════════════════════╗" -ForegroundColor Magenta
Write-Host "  ║     GlobiPOS Terminal — Windows Build        ║" -ForegroundColor Magenta
Write-Host "  ╚══════════════════════════════════════════════╝" -ForegroundColor Magenta
Write-Host ""

# ── 1. Check prerequisites ────────────────────────────────────────────────────
if (-not $SkipPrereqs) {
  Write-Info "Checking prerequisites…"

  # Node.js
  $nodeCmd = Get-Command "node" -ErrorAction SilentlyContinue
  if (-not $nodeCmd) {
    Write-Warn "Node.js not found."
    Write-Host "  Install from: https://nodejs.org (choose LTS version)" -ForegroundColor Yellow
    Write-Host "  After installing Node.js, re-run this script." -ForegroundColor Yellow
    exit 1
  }
  $nodeVer = & node --version
  Write-Success "Node.js $nodeVer"

  # Rust
  $rustCmd = Get-Command "rustc" -ErrorAction SilentlyContinue
  if (-not $rustCmd) {
    Write-Warn "Rust not found. Downloading rustup installer…"
    $rustupUrl = "https://static.rust-lang.org/rustup/dist/x86_64-pc-windows-msvc/rustup-init.exe"
    $rustupExe = Join-Path $env:TEMP "rustup-init.exe"
    Invoke-WebRequest -Uri $rustupUrl -OutFile $rustupExe -UseBasicParsing
    Write-Info "Running rustup installer (choose option 1 — default install)…"
    Start-Process -FilePath $rustupExe -ArgumentList "-y" -Wait
    # Refresh PATH
    $env:PATH = [System.Environment]::GetEnvironmentVariable("PATH", "Machine") + ";" +
                [System.Environment]::GetEnvironmentVariable("PATH", "User")
    $rustCmd = Get-Command "rustc" -ErrorAction SilentlyContinue
    if (-not $rustCmd) {
      Write-Fail "Rust install failed. Please install manually from https://rustup.rs then re-run."
    }
  }
  $rustVer = & rustc --version
  Write-Success $rustVer

  # Visual C++ Build Tools
  $vsWhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
  $hasVS = (Test-Path $vsWhere) -and (& $vsWhere -products * -requires Microsoft.VisualCpp.Tools.HostX64.TargetX64 -latest 2>$null)
  if (-not $hasVS) {
    Write-Warn "Visual C++ Build Tools not found."
    Write-Host ""
    Write-Host "  You need 'Desktop development with C++' from:" -ForegroundColor Yellow
    Write-Host "  https://aka.ms/vs/17/release/vs_BuildTools.exe" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "  After installing, restart PowerShell and re-run this script." -ForegroundColor Yellow
    exit 1
  }
  Write-Success "Visual C++ Build Tools found"

  # WebView2 (usually pre-installed on Windows 11, required on Windows 10)
  $wv2Key = "HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}"
  if (-not (Test-Path $wv2Key)) {
    Write-Warn "WebView2 Runtime may not be installed."
    Write-Host "  Download from: https://developer.microsoft.com/microsoft-edge/webview2/" -ForegroundColor Yellow
  } else {
    Write-Success "WebView2 Runtime found"
  }
}

# ── 2. Verify pos-app exists ──────────────────────────────────────────────────
if (-not (Test-Path $PosAppDir)) { Write-Fail "pos-app directory not found at $PosAppDir" }
if (-not (Test-Path (Join-Path $PosAppDir "package.json"))) { Write-Fail "pos-app\package.json not found" }

# ── 3. Install frontend dependencies ─────────────────────────────────────────
Write-Info "Installing frontend dependencies…"
Set-Location $PosAppDir
& npm ci --prefer-offline 2>$null
if ($LASTEXITCODE -ne 0) { & npm install }
Write-Success "npm dependencies ready"

# ── 4. Optional clean ─────────────────────────────────────────────────────────
if ($Clean) {
  Write-Info "Cleaning previous build artifacts…"
  $targetDir = Join-Path $PosAppDir "src-tauri\target"
  if (Test-Path $targetDir) { Remove-Item $targetDir -Recurse -Force }
}

# ── 5. Build ──────────────────────────────────────────────────────────────────
Write-Info "Building GlobiPOS Terminal…"
Write-Info "First build takes 5–10 minutes (compiling Rust). Subsequent builds are faster."
Write-Host ""

& npx tauri build
if ($LASTEXITCODE -ne 0) { Write-Fail "Build failed. Check error messages above." }

# ── 6. Show output ────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "  ══════════════════════════════════════════════" -ForegroundColor Green
Write-Success "Build complete!"
Write-Host ""

$bundleDir = Join-Path $PosAppDir "src-tauri\target\release\bundle"
$msi = Get-ChildItem -Path $bundleDir -Filter "*.msi" -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
$exe = Get-ChildItem -Path $bundleDir -Filter "*-setup.exe" -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1

if ($msi) { Write-Host "  MSI Installer : $($msi.FullName)" -ForegroundColor Green }
if ($exe) { Write-Host "  EXE Portable  : $($exe.FullName)" -ForegroundColor Green }

Write-Host ""
Write-Host "  Next steps:" -ForegroundColor Cyan
Write-Host "  1. Double-click the .msi to install"
Write-Host "  2. Launch GlobiPOS Terminal from Start Menu"
Write-Host "  3. Enter your server URL + terminal code"
Write-Host "  4. Click Register — done."
Write-Host "  ══════════════════════════════════════════════" -ForegroundColor Green
