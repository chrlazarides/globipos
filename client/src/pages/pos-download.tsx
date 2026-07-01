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
  Wifi, KeyRound, Github, Code2, Package, Star,
  Chrome, Layers, ArrowRight,
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
  // PWA install (works on all platforms)
  pwaBrowser: string;
  pwaSteps: PwaStep[];
  pwaNotes?: string;
  // Native build
  nativeFiles: NativeFile[];
  buildCmd: string;
  buildOutput: string;
  nativePrereqs: string[];
  postInstallSteps: string[];
  nativeNote?: string;
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
      { step: "Open Chrome or Edge and go to your GlobiPOS URL" },
      { step: "Click the install icon (⊕) in the address bar", note: "Edge shows it as 'App available'" },
      { step: 'Click "Install" — Windows adds it to your Start Menu and taskbar' },
      { step: "Launch from Start Menu or taskbar shortcut" },
    ],
    pwaNotes: "Works without administrator rights. Runs in its own window just like a native app.",
    nativeFiles: [
      { label: "MSI Installer (recommended)", suffix: "_x64_en-US.msi" },
      { label: "Portable EXE", suffix: "_x64-setup.exe" },
    ],
    buildCmd: "npm run tauri build",
    buildOutput: "pos-app\\src-tauri\\target\\release\\bundle\\msi\\*.msi",
    nativePrereqs: [
      "Node.js 20 LTS — nodejs.org",
      "Rust — rustup.rs (run installer, choose defaults)",
      "VS Build Tools → 'Desktop development with C++'",
    ],
    postInstallSteps: [
      "Download and double-click the .msi installer",
      "Click through the install wizard",
      'Launch "GlobiPOS Terminal" from Start Menu',
      "Enter your server URL and terminal code → Register",
    ],
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
      { step: 'Click "Install" — the app appears in Launchpad and Applications' },
      { step: "Open it from Launchpad or Spotlight (⌘Space → GlobiPOS)" },
    ],
    pwaNotes: "Safari on macOS 14+ also supports PWA install via File → Add to Dock.",
    nativeFiles: [{ label: "DMG (Universal — Intel + Apple Silicon)", suffix: "_universal.dmg" }],
    buildCmd: "npm run tauri build -- --target universal-apple-darwin",
    buildOutput: "pos-app/src-tauri/target/universal-apple-darwin/release/bundle/dmg/*.dmg",
    nativePrereqs: [
      "Node.js 20 LTS — nodejs.org",
      "Rust — rustup.rs",
      "Xcode Command Line Tools: xcode-select --install",
      "Universal targets: rustup target add aarch64-apple-darwin x86_64-apple-darwin",
    ],
    postInstallSteps: [
      "Download and open the .dmg",
      "Drag GlobiPOS Terminal to /Applications",
      "Right-click → Open on first launch (Gatekeeper bypass)",
      "Enter your server URL and terminal code → Register",
    ],
    nativeNote: "If blocked: System Settings → Privacy & Security → Open Anyway",
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
      { step: "Click Install — the app is added to your application launcher" },
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
      "Rust — rustup.rs",
      "Build deps: sudo apt install libwebkit2gtk-4.1-dev build-essential libssl-dev",
    ],
    postInstallSteps: [
      "AppImage: chmod +x *.AppImage then double-click or ./app.AppImage",
      "DEB: sudo dpkg -i *.deb, then launch from app menu",
      "Enter your server URL and terminal code → Register",
    ],
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
      { step: "Tap Add — a GlobiPOS icon appears on your home screen" },
      { step: "Tap the icon to launch — runs full-screen like a native app" },
    ],
    pwaNotes: "No APK, no app store. Works on phones and tablets. Supports offline selling.",
    nativeFiles: [
      { label: "APK (ARM64 — most phones)", suffix: "_aarch64.apk" },
      { label: "APK (ARMv7 — older devices)", suffix: "_armv7.apk" },
    ],
    buildCmd: "npx tauri android build --apk",
    buildOutput: "pos-app/src-tauri/gen/android/app/build/outputs/apk/**/*.apk",
    nativePrereqs: [
      "Node.js 20 LTS",
      "Rust — rustup.rs",
      "Android Studio + NDK — developer.android.com/studio",
      "Set ANDROID_HOME and NDK_HOME environment variables",
    ],
    postInstallSteps: [
      "Settings → Apps → Special access → Install unknown apps → enable for your browser",
      "Download the APK and tap to install",
      "Open GlobiPOS Terminal and register",
    ],
    nativeNote: "APK not signed for Play Store — enable 'Install unknown apps' once.",
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
    pwaNotes: "This is the recommended method for iPhone/iPad. No App Store or developer account needed.",
    nativeFiles: [],
    buildCmd: "npx tauri ios build",
    buildOutput: "Requires Apple Developer account ($99/yr) + Mac with Xcode",
    nativePrereqs: [
      "Apple Developer Program membership ($99/yr)",
      "Mac with Xcode 15+",
      "Rust + iOS targets: rustup target add aarch64-apple-ios",
      "Valid provisioning profile and code-signing certificate",
    ],
    postInstallSteps: [
      "Build and archive in Xcode",
      "Distribute via TestFlight or App Store Connect",
      "Install on device and register with your server URL",
    ],
    nativeNote: "For most deployments the PWA (above) is the best iOS solution — no account or Mac required.",
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

// ── Component ─────────────────────────────────────────────────────────────────
export default function PosDownload() {
  const detected = detectPlatform();
  const [selected, setSelected] = useState<PlatformId>(detected);
  const [copied, setCopied] = useState<string | null>(null);
  const { toast } = useToast();

  const { data: settings = [] } = useQuery<SystemSetting[]>({ queryKey: ["/api/settings"] });
  const serverUrl = typeof window !== "undefined" ? window.location.origin : "";
  const githubRepo = settings.find(s => s.key === "pos_github_repo")?.value ?? "";
  const appVersion = settings.find(s => s.key === "pos_app_version")?.value ?? "1.0.0";

  const platform = PLATFORMS.find(p => p.id === selected)!;
  const hasNativeRelease = !!githubRepo && platform.nativeFiles.length > 0;

  function copy(text: string, key: string) {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(key);
      setTimeout(() => setCopied(null), 2000);
      toast({ title: "Copied to clipboard" });
    });
  }

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Download className="w-6 h-6 text-primary" />
          Install GlobiPOS Terminal
        </h1>
        <p className="text-muted-foreground mt-1">
          The app is live and ready to install right now — no build or compilation needed.
        </p>
      </div>

      {/* Hero — ready to run NOW */}
      <Card className="border-primary/30 bg-primary/[0.03]">
        <CardContent className="pt-5 pb-4">
          <div className="flex items-start gap-4">
            <div className="w-10 h-10 rounded-full bg-green-100 flex items-center justify-center flex-shrink-0">
              <CheckCircle2 className="w-5 h-5 text-green-600" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-base flex items-center gap-2">
                Ready to install right now
                <Badge className="bg-green-500 hover:bg-green-500 text-white text-xs">No compilation needed</Badge>
              </p>
              <p className="text-sm text-muted-foreground mt-1">
                GlobiPOS is a Progressive Web App — it's already compiled and hosted at your server URL.
                Install it on any device in seconds using the steps below.
              </p>
              <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
                {(["Works offline", "Full-screen app mode", "Auto-updates", "No App Store", "No admin rights"] as const).map(f => (
                  <span key={f} className="flex items-center gap-1 bg-muted px-2 py-0.5 rounded-full">
                    <CheckCircle2 className="w-3 h-3 text-green-500" />{f}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Platform selector */}
        <div className="space-y-2">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Select Your Device</p>
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
          <Tabs defaultValue="pwa">
            <TabsList className="w-full mb-1">
              <TabsTrigger value="pwa" className="flex-1" data-testid="tab-pwa">
                <Globe className="w-3.5 h-3.5 mr-1.5" />
                Install Now (Web App)
                <Badge className="ml-1.5 bg-green-500 hover:bg-green-500 text-white text-[10px] h-4 px-1.5 font-normal">Ready</Badge>
              </TabsTrigger>
              {platform.nativeFiles.length > 0 && (
                <TabsTrigger value="native" className="flex-1" data-testid="tab-native">
                  <Package className="w-3.5 h-3.5 mr-1.5" />Native App
                </TabsTrigger>
              )}
              <TabsTrigger value="build" className="flex-1" data-testid="tab-build">
                <Code2 className="w-3.5 h-3.5 mr-1.5" />Build Source
              </TabsTrigger>
            </TabsList>

            {/* ── PWA install tab (primary) ──────────────────────────────── */}
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
                  {/* Your URL — copy it */}
                  <div className="rounded-lg bg-muted/50 border p-3 space-y-2">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Your GlobiPOS URL</p>
                    <div className="flex gap-2">
                      <code className="flex-1 px-3 py-2 rounded bg-background border text-sm font-mono select-all break-all">
                        {serverUrl}
                      </code>
                      <Button variant="outline" size="icon" onClick={() => copy(serverUrl, "url")} data-testid="btn-copy-server-url">
                        {copied === "url" ? <CheckCircle2 className="w-4 h-4 text-green-600" /> : <Copy className="w-4 h-4" />}
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">Copy this URL and open it on the target device in {platform.pwaBrowser}</p>
                  </div>

                  {/* Steps */}
                  <ol className="space-y-3">
                    {platform.pwaSteps.map((s, i) => (
                      <li key={i} className="flex gap-3">
                        <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary text-primary-foreground text-xs flex items-center justify-center font-bold">
                          {i + 1}
                        </span>
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

            {/* ── Native app tab ─────────────────────────────────────────── */}
            {platform.nativeFiles.length > 0 && (
              <TabsContent value="native" className="space-y-4 mt-3">
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base flex items-center gap-2">
                      <Package className="w-4 h-4" />
                      Native {platform.label} App
                    </CardTitle>
                    <CardDescription>
                      {hasNativeRelease
                        ? `Version ${appVersion} — download and run`
                        : "No pre-built release configured yet — configure GitHub repo in Settings"}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {hasNativeRelease ? (
                      <div className="space-y-2">
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
                      <div className="rounded-lg border border-dashed p-4 space-y-2 text-sm">
                        <div className="flex gap-2 text-muted-foreground">
                          <Info className="w-4 h-4 flex-shrink-0 mt-0.5 text-amber-500" />
                          <div>
                            <p className="font-medium text-foreground">GitHub repo not configured</p>
                            <p className="mt-1">Set <code className="bg-muted px-1 rounded text-xs">pos_github_repo</code> and <code className="bg-muted px-1 rounded text-xs">pos_app_version</code> in{" "}
                              <a href="/settings" className="underline text-primary">Settings</a> to enable download links.
                            </p>
                          </div>
                        </div>
                      </div>
                    )}

                    <Separator />

                    <div>
                      <p className="text-sm font-medium mb-3">Setup steps after installing</p>
                      <ol className="space-y-2">
                        {platform.postInstallSteps.map((step, i) => (
                          <li key={i} className="flex gap-3 text-sm">
                            <span className="flex-shrink-0 w-5 h-5 rounded-full bg-primary/10 text-primary text-xs flex items-center justify-center font-semibold">
                              {i + 1}
                            </span>
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

            {/* ── Build from source tab ──────────────────────────────────── */}
            <TabsContent value="build" className="space-y-4 mt-3">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Code2 className="w-4 h-4" />Build from Source
                  </CardTitle>
                  <CardDescription>Compile a native app yourself using Tauri</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <p className="text-sm font-medium mb-2">Prerequisites (install once)</p>
                    <ul className="text-xs space-y-1 bg-muted/40 rounded p-3 text-muted-foreground">
                      {platform.nativePrereqs.map((p, i) => (
                        <li key={i} className="flex gap-1.5"><span>•</span><span>{p}</span></li>
                      ))}
                    </ul>
                  </div>

                  <div>
                    <p className="text-sm font-medium mb-2">Build command</p>
                    <div className="flex gap-2">
                      <code className="flex-1 block px-3 py-2 rounded bg-muted border text-sm font-mono break-all">
                        cd pos-app &amp;&amp; npm install &amp;&amp; {platform.buildCmd}
                      </code>
                      <Button variant="outline" size="icon" onClick={() => copy(`cd pos-app && npm install && ${platform.buildCmd}`, "build")} data-testid="btn-copy-build-cmd">
                        {copied === "build" ? <CheckCircle2 className="w-4 h-4 text-green-600" /> : <Copy className="w-4 h-4" />}
                      </Button>
                    </div>
                  </div>

                  <div>
                    <p className="text-sm font-medium mb-1">Output location</p>
                    <code className="block px-3 py-2 rounded bg-muted border text-xs font-mono text-muted-foreground break-all">
                      {platform.buildOutput}
                    </code>
                  </div>

                  <div className="rounded-lg bg-muted/40 border p-3 text-xs text-muted-foreground flex gap-2">
                    <Github className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                    <span>
                      Push a version tag to trigger automated CI builds for all platforms:{" "}
                      <code className="bg-background px-1 rounded">git tag v1.0.1 &amp;&amp; git push --tags</code>
                      {" · "}Workflow: <code className="bg-background px-1 rounded">.github/workflows/build-pos.yml</code>
                    </span>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>

          {/* ── Connection details ────────────────────────────────────────── */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Wifi className="w-4 h-4 text-primary" />
                Terminal Connection Details
              </CardTitle>
              <CardDescription>Enter these on the terminal registration screen on first launch.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label className="flex items-center gap-1.5 text-sm">
                  <Globe className="w-3.5 h-3.5" />Server URL
                </Label>
                <div className="flex gap-2">
                  <Input value={serverUrl} readOnly className="font-mono text-sm bg-muted" data-testid="input-server-url" />
                  <Button variant="outline" size="icon" onClick={() => copy(serverUrl, "srv")} data-testid="btn-copy-url">
                    {copied === "srv" ? <CheckCircle2 className="w-4 h-4 text-green-600" /> : <Copy className="w-4 h-4" />}
                  </Button>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label className="flex items-center gap-1.5 text-sm">
                  <KeyRound className="w-3.5 h-3.5" />Terminal Code
                </Label>
                <div className="flex items-center gap-3">
                  <code className="px-3 py-2 rounded bg-muted border text-sm font-mono">T001</code>
                  <p className="text-xs text-muted-foreground">
                    Manage codes in{" "}
                    <a href="/pos/terminals" className="text-primary underline">POS → Terminals</a>
                  </p>
                </div>
              </div>

              <div className="rounded-lg bg-muted/40 border p-3 space-y-1.5">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">What happens on first launch</p>
                {[
                  "Terminal registers and receives an auth token from this server",
                  "Product catalog, button layout, and cashier PINs download automatically",
                  "PIN pad appears — enter any cashier PIN to start selling",
                  "Terminal syncs every 5 min and works offline when connection drops",
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
