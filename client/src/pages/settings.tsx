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
  Database, Lock, Unlock, Shield, Download, Upload,
  Mail, Eye, EyeOff, CheckCircle2, AlertCircle, Send, Wifi, WifiOff, Users,
  RotateCcw, GitCommit, FileCheck, Info, Trash2, Server,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { SystemSetting } from "@shared/schema";
import { useAuth } from "@/App";
import { UsersContent } from "./users";

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
const SESSION_KEY = "gastronobile_settings_auth";

export default function SettingsPage() {
  const { user: currentUser } = useAuth();
  const isSuperuser = currentUser?.role === "superuser";
  const isAdminOrHigher = currentUser?.role === "admin" || currentUser?.role === "superuser";

  // Tab state — Users tab visible to admin/superuser
  const [activeTab, setActiveTab] = useState<"settings" | "users">("settings");

  const [values, setValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const { toast } = useToast();

  // Password gate (superusers bypass automatically)
  const [authenticated, setAuthenticated] = useState(isSuperuser);
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

  // Full accounting reset
  const [resetConfirming, setResetConfirming] = useState(false);
  const [resetCode, setResetCode] = useState("");
  const [resetting, setResetting] = useState(false);

  const handleFullReset = async () => {
    if (resetCode !== "RESET") return;
    setResetting(true);
    try {
      const res = await apiRequest("POST", "/api/accounting/full-reset", {});
      if (!res.ok) { const err = await res.json(); throw new Error(err.message); }
      queryClient.invalidateQueries();
      toast({ title: "Accounting reset complete", description: "All balances, payments and journal entries have been cleared." });
      setResetConfirming(false);
      setResetCode("");
    } catch (err: any) {
      toast({ title: "Reset failed", description: err.message, variant: "destructive" });
    } finally {
      setResetting(false);
    }
  };

  // Restore from backup
  type BackupMeta = {
    version: number; backupType: string; exportedAt: string;
    sinceDate: string | null; tableCounts: Record<string, number>; totalRecords: number;
  };
  const [restoreMeta, setRestoreMeta] = useState<BackupMeta | null>(null);
  const [restoreFile, setRestoreFile] = useState<any>(null);
  const [restoring, setRestoring] = useState(false);
  const [restoreInspecting, setRestoreInspecting] = useState(false);

  // Data migration (dev → production)
  const [importing, setImporting] = useState(false);

  // Email section
  const [testEmailAddr, setTestEmailAddr] = useState("");
  const [sendingTest, setSendingTest] = useState(false);
  const [configApiKey, setConfigApiKey] = useState("");
  const [configFromEmail, setConfigFromEmail] = useState("");
  const [configReplyTo, setConfigReplyTo] = useState("");
  const [showApiKey, setShowApiKey] = useState(false);
  const [savingEmailConfig, setSavingEmailConfig] = useState(false);

  const { data: settings, isLoading } = useQuery<SystemSetting[]>({
    queryKey: ["/api/settings"],
  });

  const { data: emailStatus, isLoading: emailStatusLoading } = useQuery<{
    connected: boolean;
    configuredFrom: string;
    actualFrom: string;
    usingFallback: boolean;
    hasDbApiKey?: boolean;
    dbFromEmail?: string;
    dbReplyTo?: string;
    source?: string;
    error?: string;
  }>({
    queryKey: ["/api/email-status"],
  });

  // Check session auth on mount — superusers are always authenticated
  useEffect(() => {
    if (isSuperuser) { setAuthenticated(true); return; }
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
  }, [isSuperuser]);

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

  const handleExportData = async () => {
    try {
      const res = await fetch("/api/admin/export", { credentials: "include" });
      if (!res.ok) throw new Error(await res.text());
      const disposition = res.headers.get("Content-Disposition") || "";
      const match = disposition.match(/filename="([^"]+)"/);
      const filename = match?.[1] || `export-${new Date().toISOString().slice(0,10)}.json`;
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
      toast({ title: "Export complete", description: "Import this file in the production app to migrate your data." });
    } catch (err: any) {
      toast({ title: "Export failed", description: err.message, variant: "destructive" });
    }
  };

  const handleImportData = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!confirm(`This will REPLACE ALL data in this system with the data from "${file.name}". Users/passwords are preserved. Are you sure?`)) {
      e.target.value = "";
      return;
    }
    setImporting(true);
    try {
      const text = await file.text();
      const json = JSON.parse(text);
      await apiRequest("POST", "/api/admin/import", json);
      toast({ title: "Import successful", description: "All data has been restored. Refreshing..." });
      setTimeout(() => window.location.reload(), 1500);
    } catch (err: any) {
      toast({ title: "Import failed", description: err.message, variant: "destructive" });
    } finally {
      setImporting(false);
      e.target.value = "";
    }
  };

  const handleDownloadBackup = (differential?: boolean) => {
    const lastBackupDate = values["backup_last_date"];
    let url = "/api/backup/export";
    if (differential && lastBackupDate) {
      url += `?since=${encodeURIComponent(lastBackupDate)}`;
    }
    window.open(url, "_blank");
  };

  const handleInspectBackup = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setRestoreInspecting(true);
    setRestoreMeta(null);
    setRestoreFile(null);
    try {
      const text = await file.text();
      const json = JSON.parse(text);
      const res = await apiRequest("POST", "/api/backup/inspect", json);
      const meta = await res.json();
      setRestoreMeta(meta);
      setRestoreFile(json);
    } catch (err: any) {
      toast({ title: "Cannot read backup file", description: err.message, variant: "destructive" });
    } finally {
      setRestoreInspecting(false);
      e.target.value = "";
    }
  };

  const handleRestoreFromBackup = async () => {
    if (!restoreFile || !restoreMeta) return;
    const label = restoreMeta.backupType === "differential" ? "differential merge" : "full restore";
    const warning = restoreMeta.backupType === "full"
      ? "This will REPLACE ALL data with the backup. Users/passwords are preserved."
      : `This will MERGE ${restoreMeta.totalRecords} new records into the current database. Existing data is not removed.`;
    if (!confirm(`${label.toUpperCase()}: ${warning}\n\nBackup taken: ${new Date(restoreMeta.exportedAt).toLocaleString()}\n\nContinue?`)) return;
    setRestoring(true);
    try {
      const res = await apiRequest("POST", "/api/backup/restore", restoreFile);
      const result = await res.json();
      toast({ title: "Restore successful", description: `${result.backupType === "differential" ? "Merged" : "Restored"} ${result.totalRecords} records. Refreshing...` });
      setRestoreMeta(null);
      setRestoreFile(null);
      setTimeout(() => window.location.reload(), 1500);
    } catch (err: any) {
      toast({ title: "Restore failed", description: err.message, variant: "destructive" });
    } finally {
      setRestoring(false);
    }
  };

  const handleSystemExport = () => {
    window.open("/api/backup/system-export", "_blank");
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

  useEffect(() => {
    if (emailStatus) {
      setConfigFromEmail(emailStatus.dbFromEmail || "");
      setConfigReplyTo(emailStatus.dbReplyTo || "");
    }
  }, [emailStatus]);

  const handleSaveEmailConfig = async () => {
    setSavingEmailConfig(true);
    try {
      const res = await apiRequest("POST", "/api/email/save-config", {
        apiKey: configApiKey || undefined,
        fromEmail: configFromEmail,
        replyTo: configReplyTo,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Failed to save");
      queryClient.invalidateQueries({ queryKey: ["/api/email-status"] });
      setConfigApiKey("");
      toast({ title: "Email settings saved", description: "Resend configuration has been updated." });
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setSavingEmailConfig(false);
    }
  };

  const [clearingKey, setClearingKey] = useState(false);
  const handleClearEmailKey = async () => {
    if (!confirm("Remove the saved API key? Email will fall back to the integration connector if available.")) return;
    setClearingKey(true);
    try {
      const res = await apiRequest("POST", "/api/email/save-config", { apiKey: "", fromEmail: configFromEmail });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Failed to clear key");
      queryClient.invalidateQueries({ queryKey: ["/api/email-status"] });
      setConfigApiKey("");
      toast({ title: "API key removed", description: "The saved Resend key has been cleared." });
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setClearingKey(false);
    }
  };

  const handleSendTestEmail = async () => {
    if (!testEmailAddr) return;
    setSendingTest(true);
    try {
      const res = await apiRequest("POST", "/api/email/send-test", { email: testEmailAddr });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Failed to send test email");
      toast({ title: "Test email sent", description: `Delivered from ${data.fromEmail} → ${data.sentTo}` });
    } catch (err: any) {
      toast({ title: "Send failed", description: err.message, variant: "destructive" });
    } finally {
      setSendingTest(false);
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

  return (
    <div className="p-6 max-w-4xl mx-auto">
      {/* Tab navigation — only for admin / superuser */}
      {isAdminOrHigher && (
        <div className="flex gap-1 border-b mb-6">
          <button
            onClick={() => setActiveTab("settings")}
            data-testid="tab-settings"
            className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors ${activeTab === "settings" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}
          >
            <Settings2 className="w-4 h-4" />
            Settings
          </button>
          <button
            onClick={() => setActiveTab("users")}
            data-testid="tab-users"
            className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors ${activeTab === "users" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}
          >
            <Users className="w-4 h-4" />
            Users
          </button>
        </div>
      )}

      {/* Users tab */}
      {activeTab === "users" && isAdminOrHigher ? (
        <>
          <PageHeader title="User Management" description="Manage who can access this system" />
          <div className="mt-6">
            <UsersContent />
          </div>
        </>
      ) : /* Settings tab — password gate for non-superusers */ !authenticated ? (
        <div className="flex items-center justify-center py-16">
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
      ) : (
        <>
      <PageHeader
        title="System Settings"
        description="Configure your system preferences and defaults"
        action={
          <div className="flex items-center gap-2 flex-wrap">
            {hasPassword && !isSuperuser && (
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

      {/* Cyprus VAT Rates Card */}
      <Card className="mt-6">
        <CardHeader className="flex flex-row items-center gap-2 p-4 pb-2">
          <div className="flex items-center justify-center w-8 h-8 rounded-md bg-primary/10">
            <Globe className="w-4 h-4 text-primary" />
          </div>
          <div>
            <h3 className="text-sm font-semibold">Cyprus VAT Rates</h3>
            <p className="text-xs text-muted-foreground">Applicable VAT rates for Cyprus — assign to product categories or individual items</p>
          </div>
        </CardHeader>
        <CardContent className="p-4 pt-0">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {[
              { rate: "19%", label: "Standard Rate", desc: "Most goods & services, alcohol, tobacco", color: "bg-red-50 border-red-200 text-red-800 dark:bg-red-900/20 dark:border-red-800 dark:text-red-300" },
              { rate: "9%", label: "Reduced Rate", desc: "Accommodation, restaurants, catering, cinema", color: "bg-amber-50 border-amber-200 text-amber-800 dark:bg-amber-900/20 dark:border-amber-800 dark:text-amber-300" },
              { rate: "5%", label: "Reduced Rate", desc: "Food items, books, medicines, water supplies", color: "bg-blue-50 border-blue-200 text-blue-800 dark:bg-blue-900/20 dark:border-blue-800 dark:text-blue-300" },
              { rate: "0%", label: "Zero / Exempt", desc: "Exports, intra-EU supplies, certain services", color: "bg-green-50 border-green-200 text-green-800 dark:bg-green-900/20 dark:border-green-800 dark:text-green-300" },
            ].map(({ rate, label, desc, color }) => (
              <div key={rate} className={`rounded-lg border p-3 ${color}`}>
                <div className="text-2xl font-bold mb-0.5">{rate}</div>
                <div className="text-xs font-semibold mb-1">{label}</div>
                <div className="text-xs opacity-80">{desc}</div>
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground mt-3">
            VAT rates can be set per category (Items → New Category) and per individual item. Invoice lines inherit the rate from the item automatically.
          </p>
        </CardContent>
      </Card>

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
            <p className="text-xs text-muted-foreground">Export, schedule, and restore your data</p>
          </div>
        </CardHeader>
        <CardContent className="p-4 pt-0 space-y-5">

          {/* Last backup + quick actions */}
          <div className="space-y-3">
            <div className="text-xs text-muted-foreground">
              Last backup: <span className="font-medium text-foreground">{lastBackupDisplay}</span>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={() => handleDownloadBackup(false)} data-testid="button-download-backup-full">
                <Download className="w-4 h-4 mr-2" />
                Full Backup
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleDownloadBackup(true)}
                disabled={!values["backup_last_date"]}
                title={!values["backup_last_date"] ? "No previous backup date — run a full backup first" : `Records created since ${lastBackupDisplay}`}
                data-testid="button-download-backup-diff"
              >
                <GitCommit className="w-4 h-4 mr-2" />
                Differential
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleEmailBackup}
                disabled={emailingBackup || !backupEmail}
                data-testid="button-email-backup-now"
              >
                <Mail className={`w-4 h-4 mr-2 ${emailingBackup ? "animate-pulse" : ""}`} />
                {emailingBackup ? "Sending..." : "Email Backup Now"}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              <strong>Full backup</strong> exports all records. <strong>Differential</strong> exports only records created since the last backup date — much smaller file.
              Daily automated backups are automatically differential (or full if &gt;8 days since last).
            </p>
          </div>

          {/* Restore from backup */}
          <div className="border-t pt-4 space-y-3">
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Restore from Backup</h4>
            <p className="text-xs text-muted-foreground">
              Upload a backup file (.json) to inspect its contents before restoring. Full backups replace all data; differential backups merge new records without removing existing data.
            </p>

            {!restoreMeta && (
              <label className="inline-block">
                <Button variant="outline" size="sm" asChild disabled={restoreInspecting} data-testid="button-inspect-backup">
                  <span className={restoreInspecting ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}>
                    <FileCheck className="w-4 h-4 mr-2" />
                    {restoreInspecting ? "Reading file..." : "Load Backup File…"}
                  </span>
                </Button>
                <input type="file" accept=".json" className="hidden" onChange={handleInspectBackup} disabled={restoreInspecting} />
              </label>
            )}

            {restoreMeta && (
              <div className="rounded-lg border bg-muted/30 p-3 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-1 text-xs">
                    <div className="flex items-center gap-2">
                      <Badge variant={restoreMeta.backupType === "full" ? "default" : "secondary"} className="text-xs">
                        {restoreMeta.backupType === "full" ? "Full Backup" : "Differential Backup"}
                      </Badge>
                      <span className="text-muted-foreground">v{restoreMeta.version}</span>
                    </div>
                    <p className="text-muted-foreground">Taken: <span className="font-medium text-foreground">{new Date(restoreMeta.exportedAt).toLocaleString()}</span></p>
                    {restoreMeta.sinceDate && (
                      <p className="text-muted-foreground">Changes since: <span className="font-medium text-foreground">{new Date(restoreMeta.sinceDate).toLocaleString()}</span></p>
                    )}
                    <p className="text-muted-foreground">Total records: <span className="font-medium text-foreground">{restoreMeta.totalRecords.toLocaleString()}</span></p>
                  </div>
                  <Button variant="ghost" size="sm" className="text-xs h-6 shrink-0" onClick={() => { setRestoreMeta(null); setRestoreFile(null); }}>
                    Clear
                  </Button>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-1 text-xs">
                  {Object.entries(restoreMeta.tableCounts).filter(([, v]) => v > 0).map(([k, v]) => (
                    <div key={k} className="flex justify-between bg-background rounded px-2 py-1 border">
                      <span className="text-muted-foreground truncate">{k}</span>
                      <span className="font-medium ml-2 shrink-0">{v}</span>
                    </div>
                  ))}
                </div>
                <div className="flex items-center gap-2 pt-1">
                  {restoreMeta.backupType === "full" ? (
                    <div className="flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400 flex-1">
                      <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                      Full restore will replace all existing data (users preserved)
                    </div>
                  ) : (
                    <div className="flex items-center gap-1.5 text-xs text-green-600 dark:text-green-400 flex-1">
                      <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                      Differential merge — existing data will not be removed
                    </div>
                  )}
                  <Button
                    size="sm"
                    onClick={handleRestoreFromBackup}
                    disabled={restoring}
                    variant={restoreMeta.backupType === "full" ? "destructive" : "default"}
                    data-testid="button-restore-backup"
                  >
                    <RotateCcw className={`w-4 h-4 mr-2 ${restoring ? "animate-spin" : ""}`} />
                    {restoring ? "Restoring..." : restoreMeta.backupType === "full" ? "Restore (Replace All)" : "Merge (Differential)"}
                  </Button>
                </div>
              </div>
            )}
          </div>

          {/* Full System Export — server migration */}
          {isSuperuser && (
            <div className="border-t pt-4 space-y-3">
              <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Full System Export</h4>
              <p className="text-xs text-muted-foreground">
                Downloads a complete snapshot — all data <strong>plus user accounts</strong> — ready to restore on a new server.
                Use this when migrating to a different host. Superuser only.
              </p>
              <div className="flex flex-wrap gap-2 items-center">
                <Button variant="outline" size="sm" onClick={handleSystemExport} data-testid="button-system-export">
                  <Server className="w-4 h-4 mr-2" />
                  Download System Export
                </Button>
              </div>
              <p className="text-xs text-amber-600 dark:text-amber-400">
                ⚠ This file contains hashed passwords. Store it securely and do not share.
              </p>
            </div>
          )}

          {/* Migrate to Production */}
          <div className="border-t pt-4 space-y-3">
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Migrate to Production</h4>
            <p className="text-xs text-muted-foreground">Export all your data here (dev), then import it into the live production app to sync everything.</p>
            <div className="flex flex-wrap gap-3 items-center">
              <Button variant="outline" size="sm" onClick={handleExportData} data-testid="button-export-data">
                <Upload className="w-4 h-4 mr-2" />
                Export All Data
              </Button>
              <label>
                <Button variant="outline" size="sm" asChild disabled={importing} data-testid="button-import-data">
                  <span className={importing ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}>
                    <Download className="w-4 h-4 mr-2" />
                    {importing ? "Importing..." : "Import Data File"}
                  </span>
                </Button>
                <input type="file" accept=".json" className="hidden" onChange={handleImportData} disabled={importing} />
              </label>
            </div>
          </div>

          {/* Automatic Daily Backup */}
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
                  <SelectItem value="true">Enabled — send daily backup email (differential if &lt;8 days)</SelectItem>
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

      {/* Danger Zone Card */}
      {isSuperuser && (
        <Card className="mt-6 border-red-200 dark:border-red-900">
          <CardHeader className="flex flex-row items-center gap-2 p-4 pb-2">
            <div className="flex items-center justify-center w-8 h-8 rounded-md bg-red-100 dark:bg-red-900/50">
              <AlertCircle className="w-4 h-4 text-red-600 dark:text-red-400" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-red-700 dark:text-red-400">Danger Zone</h3>
              <p className="text-xs text-muted-foreground">Irreversible operations — use with caution</p>
            </div>
          </CardHeader>
          <CardContent className="p-4 pt-0 space-y-4">
            <div className="rounded-lg border border-red-200 dark:border-red-800 bg-red-50/50 dark:bg-red-950/30 p-4 space-y-3">
              <div>
                <h4 className="text-sm font-semibold text-red-800 dark:text-red-300">Full Accounting Reset</h4>
                <p className="text-xs text-muted-foreground mt-1">
                  Permanently deletes all journal entries, all customer and supplier payments, resets every account balance to €0,
                  and clears all accounting snapshots. Invoice and credit note documents are kept but their payment status is reset.
                  <strong className="text-red-700 dark:text-red-400"> This cannot be undone.</strong>
                </p>
              </div>
              {!resetConfirming ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="border-red-300 text-red-700 hover:bg-red-50 dark:border-red-700 dark:text-red-300"
                  onClick={() => setResetConfirming(true)}
                  data-testid="button-accounting-reset-start"
                >
                  <Trash2 className="w-4 h-4 mr-2" />
                  Reset All Balances to Zero…
                </Button>
              ) : (
                <div className="space-y-3 pt-1">
                  <div className="flex items-start gap-2 p-3 rounded-md bg-red-100 dark:bg-red-950 border border-red-300 dark:border-red-700 text-xs text-red-800 dark:text-red-300">
                    <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                    <span>Type <strong>RESET</strong> below to confirm. This will delete all payments and journal entries and zero all balances permanently.</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Input
                      value={resetCode}
                      onChange={(e) => setResetCode(e.target.value.toUpperCase())}
                      placeholder="Type RESET to confirm"
                      className="max-w-[200px] border-red-300 dark:border-red-700 focus-visible:ring-red-400 font-mono"
                      data-testid="input-reset-confirm"
                    />
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={handleFullReset}
                      disabled={resetCode !== "RESET" || resetting}
                      data-testid="button-accounting-reset-confirm"
                    >
                      {resetting ? <RefreshCw className="w-4 h-4 mr-2 animate-spin" /> : <Trash2 className="w-4 h-4 mr-2" />}
                      {resetting ? "Resetting…" : "Confirm Reset"}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => { setResetConfirming(false); setResetCode(""); }}
                      disabled={resetting}
                      data-testid="button-accounting-reset-cancel"
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Email Card */}
      <Card className="mt-6 border-violet-200 dark:border-violet-800">
        <CardHeader className="flex flex-row items-center gap-2 p-4 pb-2">
          <div className="flex items-center justify-center w-8 h-8 rounded-md bg-violet-100 dark:bg-violet-900/50">
            <Mail className="w-4 h-4 text-violet-600 dark:text-violet-400" />
          </div>
          <div>
            <h3 className="text-sm font-semibold">Email (Resend)</h3>
            <p className="text-xs text-muted-foreground">Email delivery status and configuration</p>
          </div>
        </CardHeader>
        <CardContent className="p-4 pt-0 space-y-4">
          {emailStatusLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-5 w-48" />
              <Skeleton className="h-5 w-64" />
              <Skeleton className="h-10 w-full max-w-md" />
            </div>
          ) : (
            <div className="space-y-5">

              {/* ── Configuration ── */}
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Resend Configuration</h4>
                  {emailStatus?.hasDbApiKey && (
                    <Badge variant="outline" className="text-xs border-green-300 text-green-700 dark:border-green-700 dark:text-green-400 gap-1">
                      <CheckCircle2 className="w-3 h-3" />
                      Key saved in this system
                    </Badge>
                  )}
                </div>

                {/* Independence notice */}
                <div className="flex items-start gap-2 p-3 rounded-md bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 text-blue-800 dark:text-blue-300 text-xs max-w-xl">
                  <Info className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  <span>
                    <strong>Fully independent per environment.</strong> Saving an API key here stores it in <em>this system's database</em> and takes priority over everything else. Dev and production each have their own saved key — configuring one does not affect the other.
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-xl">
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">API Key</Label>
                    <div className="relative">
                      <Input
                        type={showApiKey ? "text" : "password"}
                        placeholder={emailStatus?.hasDbApiKey ? "re_••••••••• (saved — enter new to replace)" : "re_xxxxxxxxxxxx"}
                        value={configApiKey}
                        onChange={(e) => setConfigApiKey(e.target.value)}
                        className="pr-9 font-mono text-xs"
                        data-testid="input-resend-api-key"
                      />
                      <button
                        type="button"
                        onClick={() => setShowApiKey(v => !v)}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      >
                        {showApiKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                    <p className="text-xs text-muted-foreground">Get your key from <strong>resend.com/api-keys</strong></p>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">From Email Address</Label>
                    <Input
                      type="email"
                      placeholder="invoices@yourdomain.com"
                      value={configFromEmail}
                      onChange={(e) => setConfigFromEmail(e.target.value)}
                      data-testid="input-resend-from-email"
                    />
                    <p className="text-xs text-muted-foreground">Must be a verified domain in Resend</p>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Reply-To Address <span className="text-muted-foreground/60">(optional)</span></Label>
                    <Input
                      type="email"
                      placeholder="support@yourdomain.com"
                      value={configReplyTo}
                      onChange={(e) => setConfigReplyTo(e.target.value)}
                      data-testid="input-resend-reply-to"
                    />
                    <p className="text-xs text-muted-foreground">Customers will reply to this address</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    onClick={handleSaveEmailConfig}
                    disabled={savingEmailConfig}
                    data-testid="button-save-email-config"
                  >
                    <Save className="w-4 h-4 mr-2" />
                    {savingEmailConfig ? "Saving..." : "Save Email Settings"}
                  </Button>
                  {emailStatus?.hasDbApiKey && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={handleClearEmailKey}
                      disabled={clearingKey}
                      className="text-destructive hover:text-destructive hover:bg-destructive/10"
                      data-testid="button-clear-email-key"
                    >
                      <Trash2 className="w-4 h-4 mr-2" />
                      {clearingKey ? "Clearing..." : "Clear saved key"}
                    </Button>
                  )}
                </div>
              </div>

              {/* ── Status ── */}
              <div className="border-t pt-4 space-y-3">
                <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Connection Status</h4>
                <div className="flex items-center gap-2">
                  {emailStatus?.connected ? (
                    <>
                      <Wifi className="w-4 h-4 text-green-600 dark:text-green-400" />
                      <span className="text-sm text-green-600 dark:text-green-400 font-medium">Connected to Resend</span>
                      <Badge variant="outline" className="text-xs border-green-300 text-green-700 dark:border-green-700 dark:text-green-400">
                        {emailStatus.source === 'db' ? 'Using saved key' : 'Using integration'}
                      </Badge>
                    </>
                  ) : (
                    <>
                      <WifiOff className="w-4 h-4 text-destructive" />
                      <span className="text-sm text-destructive font-medium">Not connected</span>
                    </>
                  )}
                </div>

                {emailStatus?.connected && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Configured From</p>
                      <p className="font-mono text-xs bg-muted px-2 py-1.5 rounded border" data-testid="text-email-configured-from">
                        {emailStatus.configuredFrom || <span className="text-muted-foreground italic">not set</span>}
                      </p>
                    </div>
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Actual Sender</p>
                      <p className="font-mono text-xs bg-muted px-2 py-1.5 rounded border" data-testid="text-email-actual-from">
                        {emailStatus.actualFrom}
                      </p>
                    </div>
                  </div>
                )}

                {emailStatus?.usingFallback && (
                  <div className="flex items-start gap-2 text-xs p-3 rounded-md bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-300">
                    <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                    <span>
                      The from address <strong>{emailStatus.configuredFrom}</strong> is a personal email domain.
                      Emails are sent from <strong>onboarding@resend.dev</strong> instead.
                      Set a verified business domain above to send from your own address.
                    </span>
                  </div>
                )}

                {emailStatus && !emailStatus.connected && emailStatus.error && (
                  <div className="flex items-start gap-2 text-xs p-3 rounded-md bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-800 dark:text-red-300">
                    <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                    <span>{emailStatus.error}</span>
                  </div>
                )}
              </div>

              {/* ── Test email ── */}
              {emailStatus?.connected && (
                <div className="border-t pt-4 space-y-2">
                  <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Send Test Email</h4>
                  <div className="flex items-center gap-2 max-w-md">
                    <Input
                      type="email"
                      placeholder="recipient@example.com"
                      value={testEmailAddr}
                      onChange={(e) => setTestEmailAddr(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && handleSendTestEmail()}
                      data-testid="input-test-email"
                    />
                    <Button
                      size="sm"
                      onClick={handleSendTestEmail}
                      disabled={sendingTest || !testEmailAddr}
                      data-testid="button-send-test-email"
                    >
                      <Send className={`w-4 h-4 mr-2 ${sendingTest ? "animate-pulse" : ""}`} />
                      {sendingTest ? "Sending..." : "Send"}
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Confirm delivery is working — will be sent from <strong>{emailStatus.actualFrom}</strong>.
                  </p>
                </div>
              )}

            </div>
          )}
        </CardContent>
      </Card>

      </>
      )}
    </div>
  );
}
