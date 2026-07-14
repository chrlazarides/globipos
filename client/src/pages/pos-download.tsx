import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Monitor, Laptop, Terminal, Smartphone, Globe,
  Download, CheckCircle2, ExternalLink, Copy, Info,
  Wifi, KeyRound, Github, Code2, Package, Zap,
  ChevronRight, FileCode2, Play, Tag, BookOpen,
  AlertCircle, Rocket,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { SystemSetting } from "@shared/schema";

// ── Types ─────────────────────────────────────────────────────────────────────
type PlatformId = "windows" | "macos" | "linux" | "android" | "ios";

interface PwaStep { step: string; note?: string }
interface NativeFile { label: string; suffix: string }

interface Platform {
  id: PlatformId;
  label: string;
  icon: any;
  color: string;
  description: string;
  pwaBrowser: string;
  pwaSteps: PwaStep[];
  pwaNotes?: string;
  nativeFiles: NativeFile[];
  buildCmd: string;
  buildOutput: string;
  nativePrereqs: string[];
  postInstallSteps: string[];
  nativeNote?: string;
  localBuildScript?: string;
  localBuildScriptWin?: string;
}

const PLATFORMS: Platform[] = [
  {
    id: "windows",
    label: "Windows",
    icon: Monitor,
    color: "text-blue-600",
    description: "Windows 10 / 11 · 64-bit",
    pwaBrowser: "Chrome or Edge",
    pwaSteps: [
      { step: "Open Chrome or Edge and navigate to your GlobiPOS URL" },
      { step: "Click the install icon (⊕) in the address bar", note: "Edge shows it as 'App available'" },
      { step: 'Click "Install" — added to your Start Menu and taskbar' },
      { step: "Launch from Start Menu or taskbar shortcut" },
    ],
    pwaNotes: "Works without administrator rights. Runs in its own window exactly like a native app.",
    nativeFiles: [
      { label: "MSI Installer (recommended)", suffix: "_x64_en-US.msi" },
      { label: "Portable EXE", suffix: "_x64-setup.exe" },
    ],
    buildCmd: "npm run tauri build",
    buildOutput: "pos-app\\src-tauri\\target\\release\\bundle\\msi\\*.msi",
    nativePrereqs: [
      "Node.js 20 LTS (nodejs.org)",
      "Rust (rustup.rs)",
      "VS Build Tools → 'Desktop development with C++'",
      "WebView2 Runtime (pre-installed on Windows 11)",
    ],
    postInstallSteps: [
      "Double-click the .msi — click through the wizard",
      'Launch "GlobiPOS Terminal" from Start Menu',
      "Enter your server URL and terminal code → Register",
    ],
    localBuildScriptWin: "scripts/build-native.ps1",
  },
  {
    id: "macos",
    label: "macOS",
    icon: Laptop,
    color: "text-gray-700",
    description: "macOS 11+ · Intel & Apple Silicon",
    pwaBrowser: "Chrome, Edge, or Safari",
    pwaSteps: [
      { step: "Open Chrome or Edge and navigate to your GlobiPOS URL" },
      { step: "Click the install icon (⊕) in the address bar" },
      { step: 'Click "Install" — appears in Launchpad and Applications' },
      { step: "Open from Launchpad or Spotlight (⌘Space → GlobiPOS)" },
    ],
    pwaNotes: "Safari on macOS 14+ also supports PWA install via File → Add to Dock.",
    nativeFiles: [{ label: "DMG (Universal — Intel + Apple Silicon)", suffix: "_universal.dmg" }],
    buildCmd: "npm run tauri build -- --target universal-apple-darwin",
    buildOutput: "pos-app/src-tauri/target/universal-apple-darwin/release/bundle/dmg/*.dmg",
    nativePrereqs: [
      "Node.js 20 LTS (nodejs.org)",
      "Rust (rustup.rs)",
      "Xcode Command Line Tools: xcode-select --install",
      "Universal targets: rustup target add aarch64-apple-darwin x86_64-apple-darwin",
    ],
    postInstallSteps: [
      "Open the .dmg and drag GlobiPOS Terminal to /Applications",
      "Right-click → Open on first launch (Gatekeeper bypass)",
      "Enter your server URL and terminal code → Register",
    ],
    nativeNote: "Blocked by Gatekeeper? System Settings → Privacy & Security → Open Anyway",
    localBuildScript: "scripts/build-native.sh",
  },
  {
    id: "linux",
    label: "Linux",
    icon: Terminal,
    color: "text-orange-600",
    description: "Ubuntu 20.04+ / Debian / Fedora",
    pwaBrowser: "Chrome or Chromium",
    pwaSteps: [
      { step: "Open Chrome/Chromium and navigate to your GlobiPOS URL" },
      { step: "Click the install icon (⊕) in the address bar" },
      { step: "Click Install — added to your application launcher" },
      { step: "Launch from your desktop environment's app menu" },
    ],
    nativeFiles: [
      { label: "AppImage (universal — no install needed)", suffix: "_amd64.AppImage" },
      { label: "DEB package (Ubuntu / Debian)", suffix: "_amd64.deb" },
      { label: "RPM package (Fedora / RHEL)", suffix: "_amd64.rpm" },
    ],
    buildCmd: "npm run tauri build",
    buildOutput: "pos-app/src-tauri/target/release/bundle/appimage/*.AppImage",
    nativePrereqs: [
      "Node.js 20 LTS",
      "Rust (rustup.rs)",
      "sudo apt install libwebkit2gtk-4.1-dev build-essential libssl-dev",
    ],
    postInstallSteps: [
      "AppImage: chmod +x *.AppImage → double-click or ./app.AppImage",
      "DEB: sudo dpkg -i *.deb → launch from app menu",
      "Enter your server URL and terminal code → Register",
    ],
    localBuildScript: "scripts/build-native.sh",
  },
  {
    id: "android",
    label: "Android",
    icon: Smartphone,
    color: "text-green-600",
    description: "Android 8.0+ · Chrome",
    pwaBrowser: "Chrome",
    pwaSteps: [
      { step: "Open Chrome on your Android device" },
      { step: "Go to your GlobiPOS URL" },
      { step: 'Tap the browser menu (⋮) → "Add to Home screen"' },
      { step: "Tap Add — GlobiPOS icon appears on home screen" },
      { step: "Tap the icon — runs full-screen like a native app" },
    ],
    pwaNotes: "No APK, no app store. Works on phones and tablets. Supports offline selling.",
    nativeFiles: [
      { label: "APK (ARM64 — most modern phones)", suffix: "_aarch64.apk" },
      { label: "APK (ARMv7 — older devices)", suffix: "_armv7.apk" },
    ],
    buildCmd: "npx tauri android build --apk --split-per-abi",
    buildOutput: "pos-app/src-tauri/gen/android/app/build/outputs/apk/**/*.apk",
    nativePrereqs: [
      "Node.js 20 LTS",
      "Rust (rustup.rs)",
      "Android Studio + NDK (developer.android.com/studio)",
      "Set ANDROID_HOME and NDK_HOME environment variables",
    ],
    postInstallSteps: [
      "Settings → Apps → Special access → Install unknown apps → enable for your browser",
      "Download APK and tap to install",
      "Open GlobiPOS Terminal and register",
    ],
    nativeNote: "APK not signed for Play Store — enable 'Install unknown apps' once",
  },
  {
    id: "ios",
    label: "iOS / iPadOS",
    icon: Smartphone,
    color: "text-purple-600",
    description: "iPhone & iPad · Safari",
    pwaBrowser: "Safari (required)",
    pwaSteps: [
      { step: "Open Safari on your iPhone or iPad — must be Safari, not Chrome" },
      { step: "Go to your GlobiPOS URL" },
      { step: "Tap the Share button (□↑) at the bottom of the screen" },
      { step: 'Scroll down and tap "Add to Home Screen"' },
      { step: "Tap Add — the icon appears on your home screen" },
      { step: "Tap the icon to launch in full-screen mode" },
    ],
    pwaNotes: "Recommended for iPhone/iPad. No App Store or Apple Developer account needed.",
    nativeFiles: [],
    buildCmd: "npx tauri ios build",
    buildOutput: "Requires Apple Developer account ($99/yr) + Mac with Xcode",
    nativePrereqs: [
      "Apple Developer Program ($99/yr)",
      "Mac with Xcode 15+",
      "Rust iOS targets: rustup target add aarch64-apple-ios",
    ],
    postInstallSteps: [
      "Build and archive in Xcode",
      "Distribute via TestFlight or App Store Connect",
      "Install on device and register with server URL",
    ],
    nativeNote: "For most deployments the PWA (above) is the best iOS solution — no account required.",
  },
];

function detectPlatform(): PlatformId {
  if (typeof navigator === "undefined") return "windows";
  const ua = navigator.userAgent.toLowerCase();
  if (/iphone|ipad|ipod/.test(ua)) return "ios";
  if (/android/.test(ua)) return "android";
  if (/win/.test(ua)) return "windows";
  if (/mac/.test(ua)) return "macos";
  if (/linux/.test(ua)) return "linux";
  return "windows";
}

function buildReleaseUrl(repo: string, version: string, suffix: string) {
  const tag = version.startsWith("v") ? version : `v${version}`;
  const ver = tag.replace("v", "");
  return `${repo.replace(/\/$/, "")}/releases/download/${tag}/GlobiPOS.Terminal_${ver}${suffix}`;
}

// ── Live GitHub release builds ────────────────────────────────────────────────
interface ReleaseAsset {
  name: string;
  size: number;
  downloadUrl: string;
  downloads: number;
}
interface PosRelease {
  tag: string;
  name: string;
  publishedAt: string;
  prerelease: boolean;
  htmlUrl: string;
  assets: ReleaseAsset[];
}

const ASSET_PLATFORM_MATCHERS: Record<PlatformId, (name: string) => boolean> = {
  windows: (n) => n.endsWith(".msi") || n.endsWith(".exe"),
  macos:   (n) => n.endsWith(".dmg") || n.endsWith(".app.tar.gz"),
  linux:   (n) => n.endsWith(".AppImage") || n.endsWith(".deb") || n.endsWith(".rpm"),
  android: (n) => n.endsWith(".apk"),
  ios:     () => false,
};

function assetLabel(name: string): string {
  if (name.endsWith(".msi")) return "MSI Installer (recommended)";
  if (name.endsWith(".exe")) return "Setup EXE";
  if (name.endsWith(".dmg")) return "DMG (Universal — Intel + Apple Silicon)";
  if (name.endsWith(".app.tar.gz")) return "App bundle (.app.tar.gz)";
  if (name.endsWith(".AppImage")) return "AppImage (universal — no install needed)";
  if (name.endsWith(".deb")) return "DEB package (Ubuntu / Debian)";
  if (name.endsWith(".rpm")) return "RPM package (Fedora / RHEL)";
  if (name.endsWith(".apk")) {
    if (name.includes("arm64")) return "APK (ARM64 — most modern phones)";
    if (name.includes("x86_64")) return "APK (x86_64 — emulators/tablets)";
    if (name.includes("x86")) return "APK (x86 — older tablets)";
    if (name.includes("arm")) return "APK (ARMv7 — older devices)";
    return "APK";
  }
  return name;
}

function formatSize(bytes: number): string {
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1e3))} KB`;
}

// ── Main component ─────────────────────────────────────────────────────────────
export default function PosDownload() {
  const detected = detectPlatform();
  const [selected, setSelected] = useState<PlatformId>(detected);
  const [copied, setCopied] = useState<string | null>(null);
  const { toast } = useToast();

  const { data: settings = [] } = useQuery<SystemSetting[]>({ queryKey: ["/api/settings"] });
  const serverUrl = typeof window !== "undefined" ? window.location.origin : "";
  const githubRepo = settings.find(s => s.key === "pos_github_repo")?.value ?? "";
  const settingsVersion = settings.find(s => s.key === "pos_app_version")?.value ?? "1.0.0";

  const { data: releases = [], isLoading: buildsLoading, isError: buildsError } = useQuery<PosRelease[]>({
    queryKey: ["/api/pos/builds"],
  });

  const latestRelease = releases.find(r => !r.prerelease && r.assets.length > 0) ?? releases[0];
  const appVersion = latestRelease ? latestRelease.tag.replace(/^v/, "") : settingsVersion;

  const platform = PLATFORMS.find(p => p.id === selected)!;
  const platformAssets = (latestRelease?.assets ?? []).filter(a => ASSET_PLATFORM_MATCHERS[selected](a.name));
  const hasNativeRelease = platformAssets.length > 0 || (!!githubRepo && platform.nativeFiles.length > 0);

  function copy(text: string, key: string) {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(key);
      setTimeout(() => setCopied(null), 2500);
      toast({ title: "Copied to clipboard" });
    });
  }

  const localBuildScript = detected === "windows"
    ? platform.localBuildScriptWin
    : platform.localBuildScript;

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Download className="w-6 h-6 text-primary" />
          Install GlobiPOS Terminal
        </h1>
        <p className="text-muted-foreground mt-1">
          Install instantly as a web app, or compile a native binary for Windows, macOS, Linux, or Android.
        </p>
      </div>

      {/* Status banner */}
      <Card className="border-primary/30 bg-primary/[0.03]">
        <CardContent className="pt-4 pb-3">
          <div className="flex items-start gap-4">
            <div className="w-9 h-9 rounded-full bg-green-100 flex items-center justify-center flex-shrink-0 mt-0.5">
              <CheckCircle2 className="w-5 h-5 text-green-600" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-semibold flex items-center gap-2 flex-wrap">
                App is live and ready to install
                <Badge className="bg-green-500 hover:bg-green-500 text-white text-xs">PWA ready now</Badge>
                {hasNativeRelease && (
                  <Badge variant="outline" className="text-xs">Native v{appVersion} available</Badge>
                )}
              </div>
              <p className="text-sm text-muted-foreground mt-0.5">
                The PWA works on all devices with zero setup. Native compiled binaries need a one-time GitHub build (15 min).
              </p>
              <div className="flex flex-wrap gap-2 mt-2 text-xs text-muted-foreground">
                {["Works offline", "Full-screen mode", "Auto-updates", "No App Store", "No admin rights"].map(f => (
                  <span key={f} className="flex items-center gap-1 bg-muted px-2 py-0.5 rounded-full">
                    <CheckCircle2 className="w-3 h-3 text-green-500" />{f}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* All ready-to-run downloads */}
      {latestRelease && latestRelease.assets.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2 flex-wrap">
              <Package className="w-4 h-4 text-primary" />
              Ready-to-run downloads
              <Badge variant="outline" className="text-xs font-normal">{latestRelease.tag}</Badge>
              <span className="text-xs font-normal text-muted-foreground">released {new Date(latestRelease.publishedAt).toLocaleDateString()}</span>
            </CardTitle>
            <CardDescription>All compiled installers from the latest GitHub release — download and run, no build needed.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {PLATFORMS.filter(p => p.id !== "ios").map(p => {
                const assets = latestRelease.assets.filter(a => ASSET_PLATFORM_MATCHERS[p.id](a.name));
                if (assets.length === 0) return null;
                return (
                  <div key={p.id} className="rounded-lg border p-3 space-y-2" data-testid={`downloads-group-${p.id}`}>
                    <div className="flex items-center gap-2 text-sm font-semibold">
                      <p.icon className={`w-4 h-4 ${p.color}`} />
                      {p.label}
                    </div>
                    {assets.map(a => (
                      <Button key={a.name} asChild variant="outline" size="sm" className="w-full justify-start" data-testid={`btn-dl-all-${a.name}`}>
                        <a href={a.downloadUrl} target="_blank" rel="noopener noreferrer">
                          <Download className="w-3.5 h-3.5 mr-2 flex-shrink-0" />
                          <span className="truncate text-xs">{assetLabel(a.name)}</span>
                          <span className="ml-auto text-[11px] opacity-70 flex-shrink-0">{formatSize(a.size)}</span>
                        </a>
                      </Button>
                    ))}
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Platform picker */}
        <div className="space-y-2">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Select Device</p>
          {PLATFORMS.map(p => (
            <button
              key={p.id}
              data-testid={`platform-btn-${p.id}`}
              onClick={() => setSelected(p.id)}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg border text-left transition-all ${
                selected === p.id
                  ? "border-primary bg-primary/5 shadow-sm"
                  : "border-border hover:border-primary/40 hover:bg-muted/40"
              }`}
            >
              <p.icon className={`w-5 h-5 flex-shrink-0 ${p.color}`} />
              <div className="min-w-0">
                <div className="font-medium text-sm flex items-center gap-1.5">
                  {p.label}
                  {detected === p.id && (
                    <Badge variant="secondary" className="text-[10px] h-4 px-1.5 font-normal">Your device</Badge>
                  )}
                </div>
                <div className="text-xs text-muted-foreground">{p.description}</div>
              </div>
            </button>
          ))}
        </div>

        {/* Right panel */}
        <div className="lg:col-span-2 space-y-4">
          <Tabs defaultValue={hasNativeRelease ? "native" : "pwa"}>
            <TabsList className="w-full mb-1 h-auto flex-wrap">
              <TabsTrigger value="pwa" className="flex-1" data-testid="tab-pwa">
                <Globe className="w-3.5 h-3.5 mr-1.5" />
                Web App
                <Badge className="ml-1.5 bg-green-500 hover:bg-green-500 text-white text-[10px] h-4 px-1.5 font-normal">Ready now</Badge>
              </TabsTrigger>
              {platform.nativeFiles.length > 0 && (
                <TabsTrigger value="native" className="flex-1" data-testid="tab-native">
                  <Package className="w-3.5 h-3.5 mr-1.5" />Native Binary
                  {hasNativeRelease && (
                    <Badge variant="outline" className="ml-1.5 text-[10px] h-4 px-1.5 font-normal">v{appVersion}</Badge>
                  )}
                </TabsTrigger>
              )}
              <TabsTrigger value="build" className="flex-1" data-testid="tab-build">
                <Rocket className="w-3.5 h-3.5 mr-1.5" />Publish Release
              </TabsTrigger>
              <TabsTrigger value="local" className="flex-1" data-testid="tab-local">
                <Code2 className="w-3.5 h-3.5 mr-1.5" />Local Build
              </TabsTrigger>
            </TabsList>

            {/* ── Web App / PWA ─────────────────────────────────────────── */}
            <TabsContent value="pwa" className="space-y-4 mt-3">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Globe className="w-4 h-4 text-primary" />
                    Install on {platform.label}
                    <Badge variant="outline" className="text-xs font-normal">via {platform.pwaBrowser}</Badge>
                  </CardTitle>
                  <CardDescription>Follow these steps on your {platform.label} device</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="rounded-lg bg-muted/50 border p-3 space-y-2">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Your GlobiPOS URL</p>
                    <div className="flex gap-2">
                      <code className="flex-1 px-3 py-2 rounded bg-background border text-sm font-mono select-all break-all">
                        {serverUrl}
                      </code>
                      <Button variant="outline" size="icon" onClick={() => copy(serverUrl, "pwa-url")} data-testid="btn-copy-server-url">
                        {copied === "pwa-url" ? <CheckCircle2 className="w-4 h-4 text-green-600" /> : <Copy className="w-4 h-4" />}
                      </Button>
                    </div>
                  </div>
                  <ol className="space-y-3">
                    {platform.pwaSteps.map((s, i) => (
                      <li key={i} className="flex gap-3">
                        <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary text-primary-foreground text-xs flex items-center justify-center font-bold">{i + 1}</span>
                        <div>
                          <p className="text-sm">{s.step}</p>
                          {s.note && <p className="text-xs text-muted-foreground mt-0.5">{s.note}</p>}
                        </div>
                      </li>
                    ))}
                  </ol>
                  {platform.pwaNotes && (
                    <div className="flex gap-2 rounded-lg bg-blue-50 border border-blue-100 p-3 text-xs text-blue-800">
                      <Info className="w-3.5 h-3.5 flex-shrink-0 mt-0.5 text-blue-500" />
                      <p>{platform.pwaNotes}</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            {/* ── Native binary download ─────────────────────────────────── */}
            {platform.nativeFiles.length > 0 && (
              <TabsContent value="native" className="space-y-4 mt-3">
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base flex items-center gap-2">
                      <Package className="w-4 h-4" />Native {platform.label} Binary
                    </CardTitle>
                    <CardDescription>
                      {hasNativeRelease
                        ? `Version ${appVersion} — compiled for ${platform.label}`
                        : "No release published yet — use the Publish Release tab to build one"}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {buildsLoading ? (
                      <div className="space-y-2">
                        {[1, 2].map(i => (
                          <div key={i} className="h-10 rounded-md bg-muted animate-pulse" data-testid={`skeleton-build-${i}`} />
                        ))}
                      </div>
                    ) : platformAssets.length > 0 ? (
                      <div className="space-y-2">
                        {latestRelease && (
                          <div className="flex items-center gap-2 text-xs text-muted-foreground pb-1" data-testid="text-latest-release-info">
                            <Tag className="w-3 h-3" />
                            <span className="font-medium text-foreground">{latestRelease.tag}</span>
                            <span>· released {new Date(latestRelease.publishedAt).toLocaleDateString()}</span>
                          </div>
                        )}
                        {platformAssets.map(a => (
                          <Button key={a.name} asChild className="w-full justify-start" data-testid={`btn-download-${a.name}`}>
                            <a href={a.downloadUrl} target="_blank" rel="noopener noreferrer">
                              <Download className="w-4 h-4 mr-2" />
                              <span className="truncate">{assetLabel(a.name)}</span>
                              <span className="ml-auto flex items-center gap-2 text-xs opacity-70">
                                {formatSize(a.size)}
                                <ExternalLink className="w-3 h-3" />
                              </span>
                            </a>
                          </Button>
                        ))}
                        <Button asChild variant="ghost" size="sm" className="text-xs text-muted-foreground w-full justify-start">
                          <a href={latestRelease?.htmlUrl ?? `${githubRepo}/releases`} target="_blank" rel="noopener noreferrer">
                            <Github className="w-3 h-3 mr-1" /> All releases on GitHub
                          </a>
                        </Button>
                      </div>
                    ) : hasNativeRelease ? (
                      <div className="space-y-2">
                        {buildsError && (
                          <div className="flex gap-2 rounded-lg bg-amber-50 border border-amber-200 p-3 text-xs text-amber-800" data-testid="text-builds-error">
                            <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5 text-amber-500" />
                            <p>Couldn't reach GitHub to list the latest builds — showing standard links which may not match the newest release.</p>
                          </div>
                        )}
                        {platform.nativeFiles.map(f => (
                          <Button key={f.suffix} asChild className="w-full justify-start" data-testid={`btn-download-${f.suffix}`}>
                            <a href={buildReleaseUrl(githubRepo, appVersion, f.suffix)} target="_blank" rel="noopener noreferrer">
                              <Download className="w-4 h-4 mr-2" />
                              {f.label}
                              <ExternalLink className="w-3 h-3 ml-auto opacity-60" />
                            </a>
                          </Button>
                        ))}
                        <Button asChild variant="ghost" size="sm" className="text-xs text-muted-foreground w-full justify-start">
                          <a href={`${githubRepo}/releases`} target="_blank" rel="noopener noreferrer">
                            <Github className="w-3 h-3 mr-1" /> All releases on GitHub
                          </a>
                        </Button>
                      </div>
                    ) : (
                      <div className="rounded-lg border border-dashed p-5 space-y-3">
                        <div className="flex gap-3">
                          <AlertCircle className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
                          <div className="space-y-1">
                            <p className="font-medium text-sm">No compiled release yet</p>
                            <p className="text-sm text-muted-foreground">
                              The source code is complete and ready to compile. Use the <strong>Publish Release</strong> tab to build native binaries via GitHub Actions — it takes about 15 minutes and produces a download link for every platform.
                            </p>
                          </div>
                        </div>
                        <div className="flex gap-2 flex-wrap">
                          <Badge variant="outline" className="text-xs">Windows .msi</Badge>
                          <Badge variant="outline" className="text-xs">macOS .dmg</Badge>
                          <Badge variant="outline" className="text-xs">Linux .AppImage</Badge>
                          <Badge variant="outline" className="text-xs">Android .apk</Badge>
                        </div>
                      </div>
                    )}

                    <Separator />

                    <div>
                      <p className="text-sm font-medium mb-3">Setup steps after installing</p>
                      <ol className="space-y-2">
                        {platform.postInstallSteps.map((step, i) => (
                          <li key={i} className="flex gap-3 text-sm">
                            <span className="flex-shrink-0 w-5 h-5 rounded-full bg-primary/10 text-primary text-xs flex items-center justify-center font-semibold">{i + 1}</span>
                            <span className="text-muted-foreground">{step}</span>
                          </li>
                        ))}
                      </ol>
                    </div>
                    {platform.nativeNote && (
                      <p className="text-xs text-muted-foreground flex gap-1.5">
                        <Info className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />{platform.nativeNote}
                      </p>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>
            )}

            {/* ── Publish release (GitHub Actions) ──────────────────────── */}
            <TabsContent value="build" className="space-y-4 mt-3">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Rocket className="w-4 h-4 text-primary" />
                    Publish a Compiled Release
                  </CardTitle>
                  <CardDescription>
                    Push a version tag to GitHub → Actions builds all 4 platforms → download links appear automatically
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-5">
                  {/* Step-by-step */}
                  <ol className="space-y-4">
                    {/* Step 1 */}
                    <li className="flex gap-3">
                      <span className="flex-shrink-0 w-7 h-7 rounded-full bg-primary text-primary-foreground text-sm flex items-center justify-center font-bold">1</span>
                      <div className="flex-1 space-y-2">
                        <p className="font-medium text-sm">Push this project to GitHub</p>
                        <p className="text-xs text-muted-foreground">Create a new repository on github.com, then add it as a remote:</p>
                        <div className="relative">
                          <code className="block px-3 py-2.5 rounded bg-muted border text-xs font-mono leading-relaxed whitespace-pre-wrap break-all">
{`git remote add origin https://github.com/YOUR_ORG/globipos.git
git push -u origin main`}
                          </code>
                          <Button variant="ghost" size="icon" className="absolute top-1 right-1 h-7 w-7" onClick={() => copy("git remote add origin https://github.com/YOUR_ORG/globipos.git\ngit push -u origin main", "step1")}>
                            {copied === "step1" ? <CheckCircle2 className="w-3.5 h-3.5 text-green-600" /> : <Copy className="w-3.5 h-3.5" />}
                          </Button>
                        </div>
                      </div>
                    </li>

                    {/* Step 2 */}
                    <li className="flex gap-3">
                      <span className="flex-shrink-0 w-7 h-7 rounded-full bg-primary text-primary-foreground text-sm flex items-center justify-center font-bold">2</span>
                      <div className="flex-1 space-y-2">
                        <p className="font-medium text-sm">Run the publish script</p>
                        <p className="text-xs text-muted-foreground">This bumps the version, creates a git tag, and pushes it to GitHub to trigger the build:</p>
                        <div className="relative">
                          <code className="block px-3 py-2.5 rounded bg-muted border text-xs font-mono">
                            chmod +x scripts/publish-release.sh && ./scripts/publish-release.sh 1.0.0
                          </code>
                          <Button variant="ghost" size="icon" className="absolute top-1 right-1 h-7 w-7" onClick={() => copy("chmod +x scripts/publish-release.sh && ./scripts/publish-release.sh 1.0.0", "step2")}>
                            {copied === "step2" ? <CheckCircle2 className="w-3.5 h-3.5 text-green-600" /> : <Copy className="w-3.5 h-3.5" />}
                          </Button>
                        </div>
                        <p className="text-xs text-muted-foreground">Or manually: <code className="bg-muted px-1 rounded">git tag v1.0.0 &amp;&amp; git push origin v1.0.0</code></p>
                      </div>
                    </li>

                    {/* Step 3 */}
                    <li className="flex gap-3">
                      <span className="flex-shrink-0 w-7 h-7 rounded-full bg-primary text-primary-foreground text-sm flex items-center justify-center font-bold">3</span>
                      <div className="flex-1 space-y-2">
                        <p className="font-medium text-sm">GitHub Actions builds all platforms (~15 min)</p>
                        <div className="grid grid-cols-2 gap-2 text-xs">
                          {[
                            { platform: "Windows", file: ".msi installer + .exe portable", time: "~8 min" },
                            { platform: "macOS", file: ".dmg (Intel + Apple Silicon)", time: "~12 min" },
                            { platform: "Linux", file: ".AppImage + .deb + .rpm", time: "~10 min" },
                            { platform: "Android", file: ".apk (ARM64 + ARMv7)", time: "~15 min" },
                          ].map(b => (
                            <div key={b.platform} className="rounded border p-2 bg-muted/30 space-y-0.5">
                              <p className="font-medium">{b.platform}</p>
                              <p className="text-muted-foreground">{b.file}</p>
                              <p className="text-muted-foreground">{b.time}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    </li>

                    {/* Step 4 */}
                    <li className="flex gap-3">
                      <span className="flex-shrink-0 w-7 h-7 rounded-full bg-primary text-primary-foreground text-sm flex items-center justify-center font-bold">4</span>
                      <div className="flex-1 space-y-2">
                        <p className="font-medium text-sm">Configure download links here</p>
                        <p className="text-xs text-muted-foreground">Set these two values in <a href="/settings" className="text-primary underline">Settings</a> to make the Native Binary tab show real download buttons:</p>
                        <div className="space-y-2">
                          <div className="rounded border p-2 bg-muted/30 text-xs font-mono space-y-1">
                            <p><span className="text-muted-foreground">pos_github_repo</span> = https://github.com/YOUR_ORG/globipos</p>
                            <p><span className="text-muted-foreground">pos_app_version</span> = 1.0.0</p>
                          </div>
                        </div>
                      </div>
                    </li>
                  </ol>

                  <div className="rounded-lg bg-muted/40 border p-3 flex gap-2 text-xs text-muted-foreground">
                    <FileCode2 className="w-4 h-4 flex-shrink-0 mt-0.5 text-primary" />
                    <span>
                      The build workflow is already configured at <code className="bg-background px-1 rounded">.github/workflows/build-pos.yml</code> — no changes needed. It automatically runs on every version tag push.
                    </span>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            {/* ── Local build ────────────────────────────────────────────── */}
            <TabsContent value="local" className="space-y-4 mt-3">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Code2 className="w-4 h-4" />Build Locally on Your Machine
                  </CardTitle>
                  <CardDescription>
                    Compile the app on your own computer — no GitHub account required
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-5">

                  {/* Quick-start scripts */}
                  <div className="space-y-3">
                    <p className="text-sm font-medium">Quick-start build scripts (recommended)</p>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      <div className="rounded-lg border p-3 space-y-2">
                        <div className="flex items-center gap-2">
                          <Terminal className="w-4 h-4 text-orange-600" />
                          <span className="font-medium text-sm">macOS / Linux</span>
                        </div>
                        <p className="text-xs text-muted-foreground">Installs Rust automatically if missing, then builds</p>
                        <div className="relative">
                          <code className="block px-2.5 py-2 rounded bg-muted text-xs font-mono whitespace-pre-wrap break-all">
                            chmod +x scripts/build-native.sh{"\n"}./scripts/build-native.sh
                          </code>
                          <Button variant="ghost" size="icon" className="absolute top-1 right-1 h-6 w-6" onClick={() => copy("chmod +x scripts/build-native.sh && ./scripts/build-native.sh", "mac-script")}>
                            {copied === "mac-script" ? <CheckCircle2 className="w-3 h-3 text-green-600" /> : <Copy className="w-3 h-3" />}
                          </Button>
                        </div>
                      </div>

                      <div className="rounded-lg border p-3 space-y-2">
                        <div className="flex items-center gap-2">
                          <Monitor className="w-4 h-4 text-blue-600" />
                          <span className="font-medium text-sm">Windows</span>
                        </div>
                        <p className="text-xs text-muted-foreground">Run in PowerShell (as Administrator)</p>
                        <div className="relative">
                          <code className="block px-2.5 py-2 rounded bg-muted text-xs font-mono whitespace-pre-wrap break-all">
                            .\scripts\build-native.ps1
                          </code>
                          <Button variant="ghost" size="icon" className="absolute top-1 right-1 h-6 w-6" onClick={() => copy(".\\scripts\\build-native.ps1", "win-script")}>
                            {copied === "win-script" ? <CheckCircle2 className="w-3 h-3 text-green-600" /> : <Copy className="w-3 h-3" />}
                          </Button>
                        </div>
                      </div>
                    </div>
                  </div>

                  <Separator />

                  {/* Manual steps */}
                  <div className="space-y-3">
                    <p className="text-sm font-medium">Manual build steps</p>
                    <div className="space-y-2">
                      <div>
                        <p className="text-xs font-medium text-muted-foreground mb-1.5">Prerequisites (install once)</p>
                        <ul className="text-xs space-y-1 bg-muted/40 rounded p-3 text-muted-foreground">
                          {platform.nativePrereqs.map((p, i) => (
                            <li key={i} className="flex gap-1.5"><span>•</span><span>{p}</span></li>
                          ))}
                        </ul>
                      </div>
                      <div>
                        <p className="text-xs font-medium text-muted-foreground mb-1.5">Build command</p>
                        <div className="relative">
                          <code className="block px-3 py-2.5 rounded bg-muted border text-xs font-mono break-all">
                            cd pos-app &amp;&amp; npm install &amp;&amp; {platform.buildCmd}
                          </code>
                          <Button variant="ghost" size="icon" className="absolute top-1 right-1 h-7 w-7" onClick={() => copy(`cd pos-app && npm install && ${platform.buildCmd}`, "build-cmd")}>
                            {copied === "build-cmd" ? <CheckCircle2 className="w-3.5 h-3.5 text-green-600" /> : <Copy className="w-3.5 h-3.5" />}
                          </Button>
                        </div>
                      </div>
                      <div>
                        <p className="text-xs font-medium text-muted-foreground mb-1.5">Output location</p>
                        <code className="block px-3 py-2 rounded bg-muted border text-xs font-mono text-muted-foreground break-all">{platform.buildOutput}</code>
                      </div>
                    </div>
                  </div>

                  <div className="rounded-lg bg-amber-50 border border-amber-100 p-3 flex gap-2 text-xs text-amber-800">
                    <Info className="w-3.5 h-3.5 flex-shrink-0 mt-0.5 text-amber-500" />
                    <span>First build downloads ~200 Rust crates and takes 5–10 minutes. Subsequent builds complete in under 2 minutes.</span>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>

          {/* ── Connection details ─────────────────────────────────────── */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Wifi className="w-4 h-4 text-primary" />
                Terminal Connection Details
              </CardTitle>
              <CardDescription>Enter these into the app on first launch to connect to this server.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label className="flex items-center gap-1.5 text-sm"><Globe className="w-3.5 h-3.5" />Server URL</Label>
                <div className="flex gap-2">
                  <Input value={serverUrl} readOnly className="font-mono text-sm bg-muted" data-testid="input-server-url" />
                  <Button variant="outline" size="icon" onClick={() => copy(serverUrl, "srv")} data-testid="btn-copy-url">
                    {copied === "srv" ? <CheckCircle2 className="w-4 h-4 text-green-600" /> : <Copy className="w-4 h-4" />}
                  </Button>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="flex items-center gap-1.5 text-sm"><KeyRound className="w-3.5 h-3.5" />Terminal Code</Label>
                <div className="flex items-center gap-3">
                  <code className="px-3 py-2 rounded bg-muted border text-sm font-mono">T001</code>
                  <p className="text-xs text-muted-foreground">
                    Manage codes in <a href="/pos/terminals" className="text-primary underline">POS → Terminals</a>
                  </p>
                </div>
              </div>
              <div className="rounded-lg bg-muted/40 border p-3 space-y-1.5">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">What happens on first launch</p>
                {[
                  "Terminal registers with this server and downloads its auth token",
                  "Product catalog, button layout, and cashier PINs sync automatically",
                  "PIN pad appears — enter any cashier PIN to start selling",
                  "Terminal syncs every 5 min; works offline when connection drops",
                ].map((s, i) => (
                  <div key={i} className="flex gap-2 text-xs text-muted-foreground">
                    <CheckCircle2 className="w-3.5 h-3.5 text-green-500 flex-shrink-0 mt-0.5" />{s}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
