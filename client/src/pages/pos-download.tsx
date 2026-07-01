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
  Wifi, KeyRound, Github, Code2, Package,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { SystemSetting } from "@shared/schema";

type PlatformId = "windows" | "macos" | "linux" | "android" | "ios";

interface Platform {
  id: PlatformId;
  label: string;
  icon: any;
  color: string;
  description: string;
  files: { label: string; suffix: string }[];
  buildCmd: string;
  buildOutput: string;
  installSteps: string[];
  note?: string;
  isPwa?: boolean;
}

const PLATFORMS: Platform[] = [
  {
    id: "windows",
    label: "Windows",
    icon: Monitor,
    color: "text-blue-600",
    description: "Windows 10 / 11 · 64-bit",
    files: [
      { label: "MSI Installer (recommended)", suffix: "_x64_en-US.msi" },
      { label: "Portable EXE", suffix: "_x64-setup.exe" },
    ],
    buildCmd: "npm run tauri build",
    buildOutput: "pos-app\\src-tauri\\target\\release\\bundle\\msi\\*.msi",
    installSteps: [
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
    files: [{ label: "DMG (Universal)", suffix: "_universal.dmg" }],
    buildCmd: "npm run tauri build -- --target universal-apple-darwin",
    buildOutput: "pos-app/src-tauri/target/universal-apple-darwin/release/bundle/dmg/*.dmg",
    installSteps: [
      "Download the .dmg and open it",
      "Drag GlobiPOS Terminal to /Applications",
      "Right-click → Open on first launch to bypass Gatekeeper",
      "Enter your server URL and terminal code → Register",
    ],
    note: "If macOS blocks: System Settings → Privacy & Security → Open Anyway",
  },
  {
    id: "linux",
    label: "Linux",
    icon: Terminal,
    color: "text-orange-600",
    description: "Ubuntu 20.04+ / Debian / Fedora",
    files: [
      { label: "AppImage (universal)", suffix: "_amd64.AppImage" },
      { label: "DEB package", suffix: "_amd64.deb" },
    ],
    buildCmd: "npm run tauri build",
    buildOutput: "pos-app/src-tauri/target/release/bundle/appimage/*.AppImage",
    installSteps: [
      "Download AppImage or .deb",
      "AppImage: chmod +x *.AppImage then run it",
      "DEB: sudo dpkg -i *.deb",
      "Launch and register with your server URL",
    ],
  },
  {
    id: "android",
    label: "Android",
    icon: Smartphone,
    color: "text-green-600",
    description: "Android 8.0 (Oreo) or later",
    files: [{ label: "APK (ARM64)", suffix: "_aarch64.apk" }],
    buildCmd: "npx tauri android build --apk",
    buildOutput: "pos-app/src-tauri/gen/android/app/build/outputs/apk/**/*.apk",
    installSteps: [
      "Settings → Apps → Special access → Install unknown apps → enable for your browser",
      "Download the APK and tap to install",
      "Open GlobiPOS Terminal",
      "Enter your server URL and terminal code → Register",
    ],
    note: 'Enable "Install unknown apps" because this is not from the Play Store',
  },
  {
    id: "ios",
    label: "iOS / iPadOS",
    icon: Smartphone,
    color: "text-purple-600",
    description: "iPhone & iPad — install as web app",
    files: [],
    buildCmd: "npx tauri ios build",
    buildOutput: "Requires Apple Developer account + Mac with Xcode",
    installSteps: [
      "Open Safari on your iPhone or iPad",
      "Go to your GlobiPOS server URL",
      "Tap Share → Add to Home Screen",
      "Tap the icon on your home screen to launch",
    ],
    isPwa: true,
    note: "Native iOS build requires an Apple Developer account ($99/yr) and Mac with Xcode. The web app (PWA) option works without any account.",
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

export default function PosDownload() {
  const detected = detectPlatform();
  const [selected, setSelected] = useState<PlatformId>(detected);
  const [copied, setCopied] = useState(false);
  const { toast } = useToast();

  const { data: settings = [] } = useQuery<SystemSetting[]>({ queryKey: ["/api/settings"] });
  const serverUrl = typeof window !== "undefined" ? window.location.origin : "";
  const githubRepo = settings.find(s => s.key === "pos_github_repo")?.value || "";
  const appVersion = settings.find(s => s.key === "pos_app_version")?.value || "1.0.0";

  const platform = PLATFORMS.find(p => p.id === selected)!;
  const hasRelease = !!githubRepo && platform.files.length > 0;

  function copy(text: string) {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      toast({ title: "Copied to clipboard" });
    });
  }

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Download className="w-6 h-6 text-primary" />
          Install GlobiPOS Terminal
        </h1>
        <p className="text-muted-foreground mt-1">
          Download the POS app for any device, then connect it to this server.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Platform selector */}
        <div className="space-y-2">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Select Platform</p>
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

          {/* Download / PWA */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-lg flex items-center gap-2">
                <platform.icon className={`w-5 h-5 ${platform.color}`} />
                {platform.label}
              </CardTitle>
              <CardDescription>{platform.description}</CardDescription>
            </CardHeader>
            <CardContent>
              <Tabs defaultValue={hasRelease ? "release" : "build"}>
                <TabsList className="mb-4">
                  {platform.files.length > 0 && (
                    <TabsTrigger value="release" data-testid="tab-release">
                      <Package className="w-3.5 h-3.5 mr-1.5" />
                      Download Release
                    </TabsTrigger>
                  )}
                  {platform.isPwa && (
                    <TabsTrigger value="pwa" data-testid="tab-pwa">
                      <Globe className="w-3.5 h-3.5 mr-1.5" />
                      Web App (PWA)
                    </TabsTrigger>
                  )}
                  <TabsTrigger value="build" data-testid="tab-build">
                    <Code2 className="w-3.5 h-3.5 mr-1.5" />
                    Build from Source
                  </TabsTrigger>
                </TabsList>

                {/* Release download tab */}
                {platform.files.length > 0 && (
                  <TabsContent value="release" className="space-y-3 mt-0">
                    {githubRepo ? (
                      <div className="space-y-2">
                        {platform.files.map(f => (
                          <Button key={f.suffix} asChild className="w-full justify-start" data-testid={`btn-download-${f.suffix}`}>
                            <a href={buildReleaseUrl(githubRepo, appVersion, f.suffix)} target="_blank" rel="noopener noreferrer">
                              <Download className="w-4 h-4 mr-2" />
                              {f.label}
                              <ExternalLink className="w-3 h-3 ml-auto opacity-60" />
                            </a>
                          </Button>
                        ))}
                        <Button asChild variant="ghost" size="sm" className="text-xs text-muted-foreground">
                          <a href={`${githubRepo}/releases`} target="_blank" rel="noopener noreferrer">
                            <Github className="w-3 h-3 mr-1" /> All releases on GitHub
                          </a>
                        </Button>
                      </div>
                    ) : (
                      <div className="rounded-lg border border-dashed p-4 space-y-2 text-sm text-muted-foreground">
                        <div className="flex items-start gap-2">
                          <Info className="w-4 h-4 mt-0.5 flex-shrink-0 text-amber-500" />
                          <div>
                            <p className="font-medium text-foreground">GitHub repository not configured</p>
                            <p className="mt-1">Set <code className="bg-muted px-1 rounded text-xs">pos_github_repo</code> in <a href="/settings" className="underline text-primary">Settings</a> to enable download links (e.g. <code className="bg-muted px-1 rounded text-xs">https://github.com/your-org/globipos</code>).</p>
                            <p className="mt-1">Use the <strong>Build from Source</strong> tab to build manually in the meantime.</p>
                          </div>
                        </div>
                      </div>
                    )}
                  </TabsContent>
                )}

                {/* PWA tab */}
                {platform.isPwa && (
                  <TabsContent value="pwa" className="space-y-3 mt-0">
                    <div className="rounded-lg bg-muted/40 p-4 space-y-2">
                      <p className="text-sm font-medium">Your server URL</p>
                      <div className="flex gap-2">
                        <code className="flex-1 px-3 py-2 rounded bg-background border text-sm font-mono select-all">{serverUrl}</code>
                        <Button variant="outline" size="icon" onClick={() => copy(serverUrl)} data-testid="btn-copy-server-url">
                          {copied ? <CheckCircle2 className="w-4 h-4 text-green-600" /> : <Copy className="w-4 h-4" />}
                        </Button>
                      </div>
                      <p className="text-xs text-muted-foreground">Open this URL in Safari on iPhone/iPad, then Add to Home Screen</p>
                    </div>
                    {platform.note && (
                      <p className="text-xs text-muted-foreground flex gap-1.5">
                        <Info className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" /> {platform.note}
                      </p>
                    )}
                  </TabsContent>
                )}

                {/* Build from source tab */}
                <TabsContent value="build" className="space-y-4 mt-0">
                  <div className="space-y-3">
                    <div>
                      <p className="text-sm font-medium mb-1">Prerequisites (install once)</p>
                      <div className="text-xs text-muted-foreground space-y-0.5 bg-muted/40 rounded p-3">
                        <p>• <strong>Node.js 20 LTS</strong> — <a href="https://nodejs.org" target="_blank" rel="noopener noreferrer" className="text-primary underline">nodejs.org</a></p>
                        <p>• <strong>Rust</strong> — <a href="https://rustup.rs" target="_blank" rel="noopener noreferrer" className="text-primary underline">rustup.rs</a> (run the installer, choose defaults)</p>
                        {selected === "windows" && <p>• <strong>VS Build Tools</strong> — <a href="https://aka.ms/vs/17/release/vs_BuildTools.exe" target="_blank" rel="noopener noreferrer" className="text-primary underline">Download</a> → "Desktop development with C++"</p>}
                        {selected === "android" && <p>• <strong>Android Studio + NDK</strong> — <a href="https://developer.android.com/studio" target="_blank" rel="noopener noreferrer" className="text-primary underline">developer.android.com</a></p>}
                        {selected === "macos" && <p>• <code className="bg-background px-1 rounded">rustup target add aarch64-apple-darwin x86_64-apple-darwin</code></p>}
                      </div>
                    </div>
                    <div>
                      <p className="text-sm font-medium mb-1">Build command</p>
                      <div className="flex gap-2">
                        <code className="flex-1 block px-3 py-2 rounded bg-muted border text-sm font-mono">
                          cd pos-app &amp;&amp; npm install &amp;&amp; {platform.buildCmd}
                        </code>
                        <Button variant="outline" size="icon" onClick={() => copy(`cd pos-app && npm install && ${platform.buildCmd}`)} data-testid="btn-copy-build-cmd">
                          <Copy className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                    <div>
                      <p className="text-sm font-medium mb-1">Output location</p>
                      <code className="block px-3 py-2 rounded bg-muted border text-xs font-mono text-muted-foreground break-all">{platform.buildOutput}</code>
                    </div>
                  </div>
                </TabsContent>
              </Tabs>

              {platform.note && platform.id !== "ios" && (
                <>
                  <Separator className="my-3" />
                  <p className="text-xs text-muted-foreground flex gap-1.5">
                    <Info className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" /> {platform.note}
                  </p>
                </>
              )}

              <Separator className="my-4" />

              {/* Install steps */}
              <div>
                <p className="text-sm font-medium mb-3">Setup steps after installing</p>
                <ol className="space-y-2">
                  {platform.installSteps.map((step, i) => (
                    <li key={i} className="flex gap-3 text-sm">
                      <span className="flex-shrink-0 w-5 h-5 rounded-full bg-primary/10 text-primary text-xs flex items-center justify-center font-semibold">
                        {i + 1}
                      </span>
                      <span className="text-muted-foreground">{step}</span>
                    </li>
                  ))}
                </ol>
              </div>
            </CardContent>
          </Card>

          {/* Connection card */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Wifi className="w-4 h-4 text-primary" />
                Connection Details
              </CardTitle>
              <CardDescription>Copy these into the terminal registration screen on first launch.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label className="flex items-center gap-1.5 text-sm">
                  <Globe className="w-3.5 h-3.5" /> Server URL
                </Label>
                <div className="flex gap-2">
                  <Input value={serverUrl} readOnly className="font-mono text-sm bg-muted" data-testid="input-server-url" />
                  <Button variant="outline" size="icon" onClick={() => copy(serverUrl)} data-testid="btn-copy-url">
                    {copied ? <CheckCircle2 className="w-4 h-4 text-green-600" /> : <Copy className="w-4 h-4" />}
                  </Button>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="flex items-center gap-1.5 text-sm">
                  <KeyRound className="w-3.5 h-3.5" /> Terminal Code
                </Label>
                <div className="flex items-center gap-3">
                  <code className="px-3 py-2 rounded bg-muted border text-sm font-mono">T001</code>
                  <p className="text-xs text-muted-foreground">
                    Find codes in <a href="/pos/terminals" className="text-primary underline">POS → Terminals</a>
                  </p>
                </div>
              </div>

              <div className="rounded-lg bg-muted/40 border p-3 space-y-1.5">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">What happens on first launch</p>
                {[
                  "Terminal registers and gets an auth token from the server",
                  "Product catalog, button layout, and cashier PINs download automatically",
                  "The PIN pad appears — enter any cashier PIN to start selling",
                  "Terminal syncs every 5 min and works offline if connection drops",
                ].map((s, i) => (
                  <div key={i} className="flex gap-2 text-xs text-muted-foreground">
                    <CheckCircle2 className="w-3.5 h-3.5 text-green-500 flex-shrink-0 mt-0.5" />
                    {s}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* GitHub Actions info */}
          <Card className="border-dashed">
            <CardContent className="pt-4">
              <div className="flex gap-3">
                <Github className="w-5 h-5 text-muted-foreground flex-shrink-0 mt-0.5" />
                <div className="space-y-1 text-sm">
                  <p className="font-medium">Automated builds via GitHub Actions</p>
                  <p className="text-xs text-muted-foreground">
                    Push a version tag and GitHub builds all platforms automatically:
                  </p>
                  <code className="block mt-1 px-3 py-2 rounded bg-muted text-xs font-mono">
                    git tag v1.0.1 &amp;&amp; git push --tags
                  </code>
                  <p className="text-xs text-muted-foreground mt-1">
                    Workflow: <code className="bg-muted px-1 rounded">.github/workflows/build-pos.yml</code>
                    {" · "}Set <code className="bg-muted px-1 rounded">pos_github_repo</code> + <code className="bg-muted px-1 rounded">pos_app_version</code> in{" "}
                    <a href="/settings" className="text-primary underline">Settings</a> to enable download links above.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
