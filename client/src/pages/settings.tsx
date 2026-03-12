import { useState, useEffect, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { PageHeader } from "@/components/page-header";
import {
  Save, RefreshCw, Building2, Receipt, Package, Globe, Settings2, Tags,
  Database, Lock, Unlock, Shield, Download,
  Mail, Eye, EyeOff, CheckCircle2,
} from "lucide-react";
import type { SystemSetting } from "@shared/schema";

const groupIcons: Record<string, any> = {
  company: Building2,
  tax: Globe,
  invoicing: Receipt,
  pricing: Tags,
  inventory: Package,
  portal: Settings2,
};

const groupLabels: Record<string, string> = {
  company: "Company Information",
  tax: "Tax & Currency",
  invoicing: "Invoicing",
  pricing: "Price Level Names",
  inventory: "Inventory",
  portal: "Customer Portal",
};

const groupOrder = ["company", "tax", "invoicing", "pricing", "inventory", "portal"];
const HIDDEN_GROUPS = ["security", "backup"];
const SESSION_KEY = "vintrade_settings_auth";

export default function SettingsPage() {
  const [values, setValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const { toast } = useToast();

  // Password gate
  const [authenticated, setAuthenticated] = useState(false);
  const [hasPassword, setHasPassword] = useState(false);
  const [gatePassword, setGatePassword] = useState("");
  const [gateError, setGateError] = useState("");
  const [gateLoading, setGateLoading] = useState(false);
  const [showGatePassword, setShowGatePassword] = useState(false);

  // Security section
  const [changePwOld, setChangePwOld] = useState("");
  const [changePwNew, setChangePwNew] = useState("");
  const [changePwConfirm, setChangePwConfirm] = useState("");
  const [changePwLoading, setChangePwLoading] = useState(false);
  const [showChangePw, setShowChangePw] = useState(false);

  // Backup section
  const [backupEmail, setBackupEmail] = useState("");
  const [backupAuto, setBackupAuto] = useState("false");
  const [backupLoading, setBackupLoading] = useState(false);
  const [emailingBackup, setEmailingBackup] = useState(false);

  const { data: settings, isLoading } = useQuery<SystemSetting[]>({
    queryKey: ["/api/settings"],
  });

  // Check session auth on mount
  useEffect(() => {
    const checkAuth = async () => {
      const cached = sessionStorage.getItem(SESSION_KEY);
      const res = await fetch("/api/settings/verify-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: "" }),
      });
      const data = await res.json();
      setHasPassword(data.hasPassword);
      if (!data.hasPassword || cached === "1") {
        setAuthenticated(true);
      }
    };
    checkAuth();
  }, []);

  useEffect(() => {
    if (settings) {
      const map: Record<string, string> = {};
      settings.forEach((s) => { map[s.key] = s.value; });
      setValues(map);
      setBackupEmail(map["backup_email"] || "");
      setBackupAuto(map["backup_auto"] || "false");
    }
  }, [settings]);

  const handleGateSubmit = async () => {
    setGateLoading(true);
    setGateError("");
    try {
      const res = await fetch("/api/settings/verify-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: gatePassword }),
      });
      const data = await res.json();
      if (data.valid) {
        sessionStorage.setItem(SESSION_KEY, "1");
        setAuthenticated(true);
      } else {
        setGateError("Incorrect password. Please try again.");
      }
    } catch {
      setGateError("Failed to verify password.");
    } finally {
      setGateLoading(false);
    }
  };

  const handleLock = () => {
    sessionStorage.removeItem(SESSION_KEY);
    setAuthenticated(false);
    setGatePassword("");
    setGateError("");
  };

  const handleChangePassword = async () => {
    if (changePwNew !== changePwConfirm) {
      toast({ title: "Passwords do not match", variant: "destructive" });
      return;
    }
    setChangePwLoading(true);
    try {
      const res = await apiRequest("POST", "/api/settings/change-password", {
        currentPassword: changePwOld,
        newPassword: changePwNew,
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message);
      }
      toast({ title: changePwNew ? "Password updated" : "Password removed", description: changePwNew ? "Settings are now password-protected." : "Password protection has been removed." });
      setChangePwOld(""); setChangePwNew(""); setChangePwConfirm("");
      setHasPassword(!!changePwNew);
      setShowChangePw(false);
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setChangePwLoading(false);
    }
  };

  const handleSeedDefaults = async () => {
    setSeeding(true);
    try {
      await apiRequest("POST", "/api/settings/seed-defaults");
      queryClient.invalidateQueries({ queryKey: ["/api/settings"] });
      toast({ title: "Defaults loaded", description: "Default settings have been initialized." });
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setSeeding(false);
    }
  };

  const handleSave = async () => {
    if (!settings) return;
    setSaving(true);
    try {
      const payload = settings
        .filter(s => !HIDDEN_GROUPS.includes(s.group))
        .map((s) => ({
          key: s.key,
          value: values[s.key] ?? s.value,
          label: s.label,
          group: s.group,
        }));
      await apiRequest("PUT", "/api/settings", { settings: payload });
      queryClient.invalidateQueries({ queryKey: ["/api/settings"] });
      toast({ title: "Settings saved", description: "Your settings have been updated." });
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleSaveBackup = async () => {
    setBackupLoading(true);
    try {
      const backupSettings = [
        { key: "backup_email", value: backupEmail, label: "Backup Email Address", group: "backup" },
        { key: "backup_auto", value: backupAuto, label: "Automatic Daily Backup", group: "backup" },
      ];
      await apiRequest("PUT", "/api/settings", { settings: backupSettings });
      queryClient.invalidateQueries({ queryKey: ["/api/settings"] });
      toast({ title: "Backup settings saved" });
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setBackupLoading(false);
    }
  };

  const handleDownloadBackup = () => {
    window.open("/api/backup/export", "_blank");
  };

  const handleEmailBackup = async () => {
    setEmailingBackup(true);
    try {
      const res = await apiRequest("POST", "/api/backup/send-email", { email: backupEmail || undefined });
      const data = await res.json();
      toast({ title: "Backup sent", description: `Backup emailed to ${data.sentTo}` });
      queryClient.invalidateQueries({ queryKey: ["/api/settings"] });
    } catch (err: any) {
      toast({ title: "Failed to send backup", description: err.message, variant: "destructive" });
    } finally {
      setEmailingBackup(false);
    }
  };

  const updateValue = (key: string, val: string) => {
    setValues((prev) => ({ ...prev, [key]: val }));
  };

  const grouped: Record<string, SystemSetting[]> = {};
  if (settings) {
    settings.forEach((s) => {
      if (HIDDEN_GROUPS.includes(s.group)) return;
      if (!grouped[s.group]) grouped[s.group] = [];
      grouped[s.group].push(s);
    });
  }

  const noSettings = !settings || settings.filter(s => !HIDDEN_GROUPS.includes(s.group)).length === 0;

  const lastBackupDate = values["backup_last_date"];
  const lastBackupDisplay = lastBackupDate
    ? new Date(lastBackupDate).toLocaleString()
    : "Never";

  const renderField = (setting: SystemSetting) => {
    const val = values[setting.key] ?? setting.value;

    if (setting.key === "currency") {
      return (
        <Select value={val} onValueChange={(v) => updateValue(setting.key, v)}>
          <SelectTrigger data-testid={`select-setting-${setting.key}`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="EUR">EUR</SelectItem>
          </SelectContent>
        </Select>
      );
    }

    if (setting.key === "payment_terms_default") {
      return (
        <Select value={val} onValueChange={(v) => updateValue(setting.key, v)}>
          <SelectTrigger data-testid={`select-setting-${setting.key}`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="cash">Cash</SelectItem>
            <SelectItem value="credit_7">Credit 7 Days</SelectItem>
            <SelectItem value="credit_14">Credit 14 Days</SelectItem>
            <SelectItem value="credit_30">Credit 30 Days</SelectItem>
            <SelectItem value="credit_60">Credit 60 Days</SelectItem>
            <SelectItem value="credit_90">Credit 90 Days</SelectItem>
          </SelectContent>
        </Select>
      );
    }

    if (setting.key === "portal_enabled" || setting.key === "portal_allow_ordering") {
      return (
        <Select value={val} onValueChange={(v) => updateValue(setting.key, v)}>
          <SelectTrigger data-testid={`select-setting-${setting.key}`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="true">Enabled</SelectItem>
            <SelectItem value="false">Disabled</SelectItem>
          </SelectContent>
        </Select>
      );
    }

    return (
      <Input
        value={val}
        onChange={(e) => updateValue(setting.key, e.target.value)}
        data-testid={`input-setting-${setting.key}`}
      />
    );
  };

  // Password gate overlay
  if (!authenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="w-full max-w-sm">
          <CardHeader className="text-center pb-2">
            <div className="flex justify-center mb-3">
              <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
                <Lock className="w-6 h-6 text-primary" />
              </div>
            </div>
            <h2 className="text-lg font-semibold">Settings Protected</h2>
            <p className="text-sm text-muted-foreground">Enter your password to access system settings</p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1">
              <Label htmlFor="gate-password">Password</Label>
              <div className="relative">
                <Input
                  id="gate-password"
                  type={showGatePassword ? "text" : "password"}
                  value={gatePassword}
                  onChange={(e) => setGatePassword(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleGateSubmit()}
                  placeholder="Enter password"
                  data-testid="input-gate-password"
                  autoFocus
                />
                <button
                  type="button"
                  onClick={() => setShowGatePassword(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showGatePassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              {gateError && <p className="text-xs text-destructive">{gateError}</p>}
            </div>
            <Button
              className="w-full"
              onClick={handleGateSubmit}
              disabled={gateLoading}
              data-testid="button-gate-unlock"
            >
              <Unlock className="w-4 h-4 mr-2" />
              {gateLoading ? "Verifying..." : "Unlock Settings"}
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <PageHeader
        title="System Settings"
        description="Configure your system preferences and defaults"
        action={
          <div className="flex items-center gap-2 flex-wrap">
            {hasPassword && (
              <Button variant="outline" size="sm" onClick={handleLock} data-testid="button-lock-settings">
                <Lock className="w-4 h-4 mr-2" />
                Lock
              </Button>
            )}
            {noSettings && !isLoading && (
              <Button variant="outline" onClick={handleSeedDefaults} disabled={seeding} data-testid="button-seed-defaults">
                <RefreshCw className={`w-4 h-4 mr-2 ${seeding ? "animate-spin" : ""}`} />
                {seeding ? "Loading..." : "Load Defaults"}
              </Button>
            )}
            {!noSettings && (
              <Button onClick={handleSave} disabled={saving} data-testid="button-save-settings">
                <Save className="w-4 h-4 mr-2" />
                {saving ? "Saving..." : "Save Settings"}
              </Button>
            )}
          </div>
        }
      />

      {isLoading ? (
        <div className="space-y-4">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-40" />)}
        </div>
      ) : noSettings ? (
        <Card>
          <CardContent className="p-8 text-center">
            <Settings2 className="w-12 h-12 mx-auto mb-4 text-muted-foreground opacity-40" />
            <h3 className="text-lg font-semibold mb-2">No settings configured yet</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Click "Load Defaults" to initialize the system with default settings for Cyprus.
            </p>
            <Button onClick={handleSeedDefaults} disabled={seeding} data-testid="button-seed-defaults-center">
              <RefreshCw className={`w-4 h-4 mr-2 ${seeding ? "animate-spin" : ""}`} />
              {seeding ? "Loading..." : "Load Default Settings"}
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {groupOrder.filter(g => grouped[g]).concat(Object.keys(grouped).filter(g => !groupOrder.includes(g))).map((group) => {
            const groupSettings = grouped[group];
            const Icon = groupIcons[group] || Settings2;
            return (
              <Card key={group}>
                <CardHeader className="flex flex-row items-center gap-2 p-4 pb-2">
                  <div className="flex items-center justify-center w-8 h-8 rounded-md bg-primary/10">
                    <Icon className="w-4 h-4 text-primary" />
                  </div>
                  <h3 className="text-sm font-semibold">{groupLabels[group] || group}</h3>
                </CardHeader>
                <CardContent className="p-4 pt-0">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {groupSettings.map((setting) => (
                      <div key={setting.key} className="space-y-1">
                        <Label htmlFor={setting.key} className="text-xs text-muted-foreground">
                          {setting.label}
                        </Label>
                        {renderField(setting)}
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Security Card */}
      <Card className="mt-6 border-blue-200 dark:border-blue-800">
        <CardHeader className="flex flex-row items-center gap-2 p-4 pb-2">
          <div className="flex items-center justify-center w-8 h-8 rounded-md bg-blue-100 dark:bg-blue-900/50">
            <Shield className="w-4 h-4 text-blue-600 dark:text-blue-400" />
          </div>
          <div>
            <h3 className="text-sm font-semibold">Settings Security</h3>
            <p className="text-xs text-muted-foreground">Password-protect access to system settings</p>
          </div>
        </CardHeader>
        <CardContent className="p-4 pt-0 space-y-4">
          <div className="flex items-center gap-3">
            {hasPassword ? (
              <div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400">
                <CheckCircle2 className="w-4 h-4" />
                Password protection is active
              </div>
            ) : (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Lock className="w-4 h-4" />
                No password set — anyone can access settings
              </div>
            )}
          </div>

          {!showChangePw ? (
            <Button variant="outline" size="sm" onClick={() => setShowChangePw(true)} data-testid="button-show-change-password">
              <Shield className="w-4 h-4 mr-2" />
              {hasPassword ? "Change Password" : "Set Password"}
            </Button>
          ) : (
            <div className="space-y-3 max-w-sm">
              {hasPassword && (
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Current Password</Label>
                  <Input
                    type="password"
                    value={changePwOld}
                    onChange={(e) => setChangePwOld(e.target.value)}
                    placeholder="Enter current password"
                    data-testid="input-current-password"
                  />
                </div>
              )}
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">New Password</Label>
                <Input
                  type="password"
                  value={changePwNew}
                  onChange={(e) => setChangePwNew(e.target.value)}
                  placeholder="Enter new password"
                  data-testid="input-new-password"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Confirm New Password</Label>
                <Input
                  type="password"
                  value={changePwConfirm}
                  onChange={(e) => setChangePwConfirm(e.target.value)}
                  placeholder="Confirm new password"
                  data-testid="input-confirm-password"
                />
              </div>
              <div className="flex gap-2">
                <Button size="sm" onClick={handleChangePassword} disabled={changePwLoading} data-testid="button-save-password">
                  <Save className="w-4 h-4 mr-2" />
                  {changePwLoading ? "Saving..." : "Save Password"}
                </Button>
                {hasPassword && (
                  <Button size="sm" variant="outline" onClick={async () => {
                    setChangePwLoading(true);
                    try {
                      const res = await apiRequest("POST", "/api/settings/change-password", {
                        currentPassword: changePwOld,
                        newPassword: "",
                      });
                      if (!res.ok) { const err = await res.json(); throw new Error(err.message); }
                      toast({ title: "Password removed", description: "Password protection has been removed." });
                      setChangePwOld(""); setChangePwNew(""); setChangePwConfirm("");
                      setHasPassword(false);
                      setShowChangePw(false);
                    } catch (err: any) {
                      toast({ title: "Error", description: err.message, variant: "destructive" });
                    } finally {
                      setChangePwLoading(false);
                    }
                  }} disabled={changePwLoading} data-testid="button-remove-password">
                    Remove Password
                  </Button>
                )}
                <Button size="sm" variant="ghost" onClick={() => setShowChangePw(false)} data-testid="button-cancel-password">
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Backup Card */}
      <Card className="mt-6 border-green-200 dark:border-green-800">
        <CardHeader className="flex flex-row items-center gap-2 p-4 pb-2">
          <div className="flex items-center justify-center w-8 h-8 rounded-md bg-green-100 dark:bg-green-900/50">
            <Database className="w-4 h-4 text-green-600 dark:text-green-400" />
          </div>
          <div>
            <h3 className="text-sm font-semibold">Backup & Recovery</h3>
            <p className="text-xs text-muted-foreground">Export your data and configure automatic backups</p>
          </div>
        </CardHeader>
        <CardContent className="p-4 pt-0 space-y-4">
          <div className="text-xs text-muted-foreground">
            Last backup: <span className="font-medium text-foreground">{lastBackupDisplay}</span>
          </div>

          <div className="flex flex-wrap gap-3">
            <Button variant="outline" size="sm" onClick={handleDownloadBackup} data-testid="button-download-backup">
              <Download className="w-4 h-4 mr-2" />
              Download Backup (JSON)
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleEmailBackup}
              disabled={emailingBackup || !backupEmail}
              data-testid="button-email-backup-now"
            >
              <Mail className={`w-4 h-4 mr-2 ${emailingBackup ? "animate-pulse" : ""}`} />
              {emailingBackup ? "Sending..." : "Send Backup Now"}
            </Button>
          </div>

          <div className="border-t pt-4 space-y-3 max-w-md">
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Automatic Daily Backup</h4>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Backup Email Address</Label>
              <Input
                type="email"
                value={backupEmail}
                onChange={(e) => setBackupEmail(e.target.value)}
                placeholder="admin@yourcompany.com"
                data-testid="input-backup-email"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Automatic Daily Backup</Label>
              <Select value={backupAuto} onValueChange={setBackupAuto}>
                <SelectTrigger data-testid="select-backup-auto">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="true">Enabled — send daily backup email</SelectItem>
                  <SelectItem value="false">Disabled</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button size="sm" onClick={handleSaveBackup} disabled={backupLoading} data-testid="button-save-backup-settings">
              <Save className="w-4 h-4 mr-2" />
              {backupLoading ? "Saving..." : "Save Backup Settings"}
            </Button>
          </div>
        </CardContent>
      </Card>

    </div>
  );
}
