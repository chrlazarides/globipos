import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Grape, LogIn } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import type { SystemSetting } from "@shared/schema";

interface PortalLoginProps {
  onLogin: (customer: any) => void;
}

export default function PortalLogin({ onLogin }: PortalLoginProps) {
  const [code, setCode] = useState("");
  const [accessCode, setAccessCode] = useState("");
  const { data: settings = [] } = useQuery<SystemSetting[]>({ queryKey: ["/api/settings"] });
  const companyName = settings.find(s => s.key === "company_name")?.value || "VINERIA DI MARE Trading";
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await apiRequest("POST", "/api/portal/login", { code, accessCode });
      const data = await res.json();
      onLogin(data.customer);
    } catch (err: any) {
      setError(err.message?.includes("401") ? "Invalid customer code or access code" : "Login failed. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center pb-2">
          <div className="flex items-center justify-center gap-2 mb-2">
            <img src="/logo.png" alt="Logo" className="h-14 object-contain dark:invert" />
          </div>
          <h1 className="text-xl font-semibold">{companyName} Portal</h1>
          <p className="text-sm text-muted-foreground">Sign in to your customer account</p>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1">
              <Label htmlFor="code">Customer Code</Label>
              <Input
                id="code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="e.g. LWH001"
                required
                data-testid="input-portal-code"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="accessCode">Access Code</Label>
              <Input
                id="accessCode"
                type="password"
                value={accessCode}
                onChange={(e) => setAccessCode(e.target.value)}
                placeholder="Enter your access code"
                required
                data-testid="input-portal-access-code"
              />
            </div>
            {error && (
              <p className="text-sm text-destructive" data-testid="text-portal-error">{error}</p>
            )}
            <Button type="submit" className="w-full" disabled={loading} data-testid="button-portal-login">
              <LogIn className="w-4 h-4 mr-2" />
              {loading ? "Signing in..." : "Sign In"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
