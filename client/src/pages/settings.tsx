import { useState, useEffect } from "react";
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
import { Save, RefreshCw, Building2, Receipt, Package, Globe, Settings2, Tags } from "lucide-react";
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

export default function SettingsPage() {
  const [values, setValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const { toast } = useToast();

  const { data: settings, isLoading } = useQuery<SystemSetting[]>({
    queryKey: ["/api/settings"],
  });

  useEffect(() => {
    if (settings) {
      const map: Record<string, string> = {};
      settings.forEach((s) => { map[s.key] = s.value; });
      setValues(map);
    }
  }, [settings]);

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
      const payload = settings.map((s) => ({
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

  const updateValue = (key: string, val: string) => {
    setValues((prev) => ({ ...prev, [key]: val }));
  };

  const grouped: Record<string, SystemSetting[]> = {};
  if (settings) {
    settings.forEach((s) => {
      if (!grouped[s.group]) grouped[s.group] = [];
      grouped[s.group].push(s);
    });
  }

  const noSettings = !settings || settings.length === 0;

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
            <SelectItem value="USD">USD</SelectItem>
            <SelectItem value="GBP">GBP</SelectItem>
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
      <PageHeader
        title="System Settings"
        description="Configure your system preferences and defaults"
        action={
          <div className="flex items-center gap-2 flex-wrap">
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
    </div>
  );
}
