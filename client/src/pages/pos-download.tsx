import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Monitor, Apple, Terminal, Smartphone, Globe,
  Download, CheckCircle2, ExternalLink, Copy, Info,
  Wifi, KeyRound, Settings2, Github
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { SystemSetting } from "@shared/schema";

type Platform = "windows" | "macos" | "linux" | "android" | "ios";

interface PlatformInfo {
  id: Platform;
  label: string;
  icon: any;
  color: string;
  badge?: string;
  description: string;
  installer: string;
  installSteps: string[];
  files: { label: string; suffix: string }[];
  note?: string;
}

const PLATFORMS: PlatformInfo[] = [
  {
    id: "windows",
    label: "Windows",
    icon: Monitor,
    color: "text-blue-600",
    description: "Windows 10 / 11 · 64-bit",
    installer: "MSI Installer",
    installSteps: [
      "Download the .msi installer",
      "Double-click to run — click through the wizard",
      "Launch \"GlobiPOS Terminal\" from Start Menu or Desktop",
      "Enter your server URL and terminal code, then Register",
    ],
    files: [
      { label: "MSI Installer (recommended)", suffix: "_x64_en-US.msi" },
      { label: "Portable EXE", suffix: "_x64-setup.exe" },
    ],
  },
  {
    id: "macos",
    label: "macOS",
    icon: Apple,
    color: "text-gray-700 dark:text-gray-200",
    badge: "Universal (Intel + Apple Silicon)",
    description: "macOS 11 Big Sur or later",
    installer: "DMG Disk Image",
    installSteps: [
      "Download the .dmg file",
      "Open it and drag GlobiPOS Terminal to Applications",
      "Right-click → Open on first launch (Gatekeeper bypass)",
      "Enter your server URL and terminal code, then Register",
    ],
    files: [{ label: "DMG (Universal)", suffix: "_universal.dmg" }],
    note: "If macOS blocks the app, go to System Settings → Privacy & Security → Open Anyway",
  },
  {
    id: "linux",
    label: "Linux",
    icon: Terminal,
    color: "text-orange-600",
    description: "Ubuntu 20.04+ / Debian / Fedora",
    installer: "AppImage or DEB",
    installSteps: [
      "Download AppImage (runs on any distro) or .deb (Debian/Ubuntu)",
      "AppImage: chmod +x *.AppImage then ./GlobiPOS*.AppImage",
      "DEB: sudo dpkg -i *.deb",
      "Launch and register with your server URL and terminal code",
    ],
    files: [
      { label: "AppImage (universal)", suffix: "_amd64.AppImage" },
      { label: "DEB package", suffix: "_amd64.deb" },
    ],
  },
  {
    id: "android",
    label: "Android",
    icon: Smartphone,
    color: "text-green-600",
    description: "Android 8.0+ (Oreo)",
    installer: "APK",
    installSteps: [
      "On your phone: Settings → Apps → Special access → Install unknown apps",
      "Enable for your browser or Files app",
      "Download the APK and tap to install",
      "Open GlobiPOS Terminal and register with your server URL",
    ],
    files: [{ label: "APK (ARM64)", suffix: "_aarch64.apk" }],
    note: "You must enable 'Install unknown apps' because this APK is not from the Play Store",
  },
  {
    id: "ios",
    label: "iOS / iPadOS",
    icon: Smartphone,
    color: "text-purple-600",
    description: "iPhone & iPad — use as PWA",
    installer: "Progressive Web App",
    installSteps: [
      "Open Safari on your iPhone or iPad",
      "Navigate to your GlobiPOS server URL",
      "Tap the Share button (box with arrow) → Add to Home Screen",
      "The app icon appears on your home screen — tap to launch",
    ],
    files: [],
    note: "Native iOS build requires an Apple Developer account and Mac with Xcode. The PWA option works without any app store.",
  },
];

function detectPlatform(): Platform {
  if (typeof navigator === "undefined") return "windows";
  const ua = navigator.userAgent.toLowerCase();
  if (/iphone|ipad|ipod/.test(ua)) return "ios";
  if (/android/.test(ua)) return "android";
  if (/win/.test(ua)) return "windows";
  if (/mac/.test(ua)) return "macos";
  if (/linux/.test(ua)) return "linux";
  return "windows";
}

function buildDownloadUrl(repo: string, version: string, suffix: string): string {
  const tag = version.startsWith("v") ? version : `v${version}`;
  const base = repo.replace(/\/$/, "");
  return `${base}/releases/download/${tag}/GlobiPOS.Terminal_${tag.replace("v", "")}${suffix}`;
}

export default function PosDownload() {
  const [selected, setSelected] = useState<Platform>(detectPlatform());
  const [terminalCode, setTerminalCode] = useState("T001");
  const [copied, setCopied] = useState(false);
  const { toast } = useToast();

  const { data: settings = [] } = useQuery<SystemSetting[]>({ queryKey: ["/api/settings"] });

  const serverUrl = typeof window !== "undefined" ? window.location.origin : "";
  const githubRepo = settings.find(s => s.key === "pos_github_repo")?.value || "";
  const appVersion = settings.find(s => s.key === "pos_app_version")?.value || "1.0.0";

  const platform = PLATFORMS.find(p => p.id === selected)!;

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      toast({ title: "Copied!", description: "Server URL copied to clipboard" });
    });
  };

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Download className="w-6 h-6 text-primary" />
          Install GlobiPOS Terminal
        </h1>
        <p className="text-muted-foreground mt-1">
          Download and install the POS terminal app on any device, then connect it to this server.
        </p>
      </div>

      {/* GitHub repo notice if not set */}
      {!githubRepo && (
        <Alert>
          <Info className="h-4 w-4" />
          <AlertDescription>
            Download links require a GitHub repository. Set <code className="text-xs bg-muted px-1 py-0.5 rounded">pos_github_repo</code> in{" "}
            <a href="/settings" className="underline text-primary">Settings</a> (e.g.{" "}
            <code className="text-xs bg-muted px-1 py-0.5 rounded">https://github.com/your-org/globipos</code>
            ) — this is where GitHub Actions publishes the built installers.
          </AlertDescription>
        </Alert>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: Platform selector */}
        <div className="space-y-3">
          <p className="text-sm font-medium text-muted-foreground uppercase tracking-wide">Choose Platform</p>
          {PLATFORMS.map(p => (
            <button
              key={p.id}
              data-testid={`platform-${p.id}`}
              onClick={() => setSelected(p.id)}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg border text-left transition-all ${
                selected === p.id
                  ? "border-primary bg-primary/5 shadow-sm"
                  : "border-border hover:border-primary/40 hover:bg-muted/50"
              }`}
            >
              <p.icon className={`w-5 h-5 flex-shrink-0 ${p.color}`} />
              <div className="min-w-0">
                <div className="font-medium text-sm flex items-center gap-2">
                  {p.label}
                  {detectPlatform() === p.id && (
                    <Badge variant="secondary" className="text-[10px] h-4 px-1.5">Your device</Badge>
                  )}
                </div>
                <div className="text-xs text-muted-foreground truncate">{p.description}</div>
              </div>
            </button>
          ))}
        </div>

        {/* Middle: Download + steps */}
        <div className="lg:col-span-2 space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-lg">
                <platform.icon className={`w-5 h-5 ${platform.color}`} />
                {platform.label}
                {platform.badge && (
                  <Badge variant="outline" className="text-xs font-normal">{platform.badge}</Badge>
                )}
              </CardTitle>
              <CardDescription>{platform.description}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Download buttons */}
              {platform.files.length > 0 ? (
                <div className="space-y-2">
                  <p className="text-sm font-medium">Download</p>
                  {platform.files.map(f => {
                    const url = githubRepo
                      ? buildDownloadUrl(githubRepo, appVersion, f.suffix)
                      : null;
                    return (
                      <div key={f.suffix} className="flex items-center gap-2">
                        {url ? (
                          <Button asChild className="flex-1 justify-start" variant="default" data-testid={`download-${platform.id}-${f.suffix}`}>
                            <a href={url} target="_blank" rel="noopener noreferrer">
                              <Download className="w-4 h-4 mr-2" />
                              {f.label}
                              <ExternalLink className="w-3 h-3 ml-auto opacity-50" />
                            </a>
                          </Button>
                        ) : (
                          <Button
                            className="flex-1 justify-start"
                            variant="outline"
                            disabled
                            data-testid={`download-${platform.id}-${f.suffix}-disabled`}
                          >
                            <Download className="w-4 h-4 mr-2" />
                            {f.label}
                            <span className="ml-auto text-xs opacity-50">Set GitHub repo first</span>
                          </Button>
                        )}
                      </div>
                    );
                  })}
                  {githubRepo && (
                    <Button asChild variant="ghost" size="sm" className="text-xs text-muted-foreground">
                      <a href={`${githubRepo}/releases`} target="_blank" rel="noopener noreferrer">
                        <Github className="w-3 h-3 mr-1" />
                        View all releases
                      </a>
                    </Button>
                  )}
                </div>
              ) : (
                <div className="flex items-center gap-3 p-3 bg-muted/50 rounded-lg">
                  <Globe className="w-5 h-5 text-purple-600 flex-shrink-0" />
                  <div>
                    <p className="text-sm font-medium">Use as Progressive Web App (PWA)</p>
                    <p className="text-xs text-muted-foreground mt-0.5">Open your server URL in Safari → Share → Add to Home Screen</p>
                  </div>
                </div>
              )}

              {platform.note && (
                <Alert className="py-2">
                  <Info className="h-3 w-3" />
                  <AlertDescription className="text-xs">{platform.note}</AlertDescription>
                </Alert>
              )}

              <Separator />

              {/* Install steps */}
              <div>
                <p className="text-sm font-medium mb-3">Setup steps</p>
                <ol className="space-y-2">
                  {platform.installSteps.map((step, i) => (
                    <li key={i} className="flex gap-3 text-sm">
                      <span className="flex-shrink-0 w-5 h-5 rounded-full bg-primary/10 text-primary text-xs flex items-center justify-center font-medium">
                        {i + 1}
                      </span>
                      <span className="text-muted-foreground pt-0.5">{step}</span>
                    </li>
                  ))}
                </ol>
              </div>
            </CardContent>
          </Card>

          {/* Connection card */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Wifi className="w-4 h-4 text-primary" />
                Server Connection
              </CardTitle>
              <CardDescription>
                Use these values when the terminal asks to register for the first time.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label className="flex items-center gap-1.5 text-sm">
                  <Globe className="w-3.5 h-3.5" /> Server URL
                </Label>
                <div className="flex gap-2">
                  <Input
                    value={serverUrl}
                    readOnly
                    className="font-mono text-sm bg-muted"
                    data-testid="server-url-display"
                  />
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => copyToClipboard(serverUrl)}
                    data-testid="copy-server-url"
                  >
                    {copied ? <CheckCircle2 className="w-4 h-4 text-green-600" /> : <Copy className="w-4 h-4" />}
                  </Button>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="flex items-center gap-1.5 text-sm">
                  <KeyRound className="w-3.5 h-3.5" /> Terminal Code
                </Label>
                <div className="flex gap-2">
                  <Input
                    value={terminalCode}
                    onChange={e => setTerminalCode(e.target.value)}
                    placeholder="e.g. T001"
                    className="font-mono text-sm max-w-[160px]"
                    data-testid="terminal-code-input"
                  />
                  <p className="text-xs text-muted-foreground self-center">
                    Find terminal codes in{" "}
                    <a href="/pos/terminals" className="underline text-primary">POS → Terminals</a>
                  </p>
                </div>
              </div>

              <div className="rounded-lg border bg-muted/30 p-3 space-y-2">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">What happens on first launch</p>
                <div className="space-y-1.5">
                  {[
                    "Terminal registers with the server and gets a session token",
                    "Product catalog, layout buttons, and cashier PINs sync automatically",
                    "Terminal works offline — syncs again when reconnected",
                    "PIN pad appears immediately after registration",
                  ].map((s, i) => (
                    <div key={i} className="flex items-start gap-2 text-xs text-muted-foreground">
                      <CheckCircle2 className="w-3.5 h-3.5 text-green-600 flex-shrink-0 mt-0.5" />
                      {s}
                    </div>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* CI/CD info */}
          <Card className="border-dashed">
            <CardContent className="pt-4">
              <div className="flex items-start gap-3">
                <Github className="w-5 h-5 text-muted-foreground flex-shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <p className="text-sm font-medium">Auto-builds via GitHub Actions</p>
                  <p className="text-xs text-muted-foreground">
                    Push a tag like <code className="bg-muted px-1 py-0.5 rounded text-[11px]">git tag v1.0.1 && git push --tags</code> and
                    GitHub Actions will automatically build installers for all platforms and attach them to a GitHub Release.
                    The workflow is at <code className="bg-muted px-1 py-0.5 rounded text-[11px]">.github/workflows/build-pos.yml</code>.
                  </p>
                  <div className="flex items-center gap-2 mt-2">
                    <Settings2 className="w-3 h-3 text-muted-foreground" />
                    <p className="text-xs text-muted-foreground">
                      Set <code className="bg-muted px-1 py-0.5 rounded text-[11px]">pos_github_repo</code> and{" "}
                      <code className="bg-muted px-1 py-0.5 rounded text-[11px]">pos_app_version</code> in{" "}
                      <a href="/settings" className="underline text-primary">Settings</a> to enable download links.
                    </p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
