import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiFetch } from "@/lib/queryClient";
import { setToken, setStaff, type StaffSession } from "@/lib/auth";
import { ScanBarcode, Lock, Loader2, ShieldCheck, ArrowLeft } from "lucide-react";

interface LoginProps {
  onLogin: (staff: StaffSession) => void;
}

export default function Login({ onLogin }: LoginProps) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [tempToken, setTempToken] = useState<string | null>(null);
  const [totpCode, setTotpCode] = useState("");
  const [error, setError] = useState<string | null>(null);

  function completeAuth(data: any) {
    if (data.role !== "staff" && data.role !== "admin" && data.role !== "superuser") {
      setError("Only staff accounts can use the handheld app.");
      return;
    }
    setToken(data.token);
    const staff: StaffSession = {
      id: data.id,
      username: data.username,
      email: data.email,
      role: data.role,
      permissions: data.permissions || [],
    };
    setStaff(staff);
    onLogin(staff);
  }

  const loginMutation = useMutation({
    mutationFn: async () => {
      return apiFetch<any>("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ username, password }),
      });
    },
    onSuccess: (data) => {
      setError(null);
      if (data.requires2fa || data.requires2faSetup) {
        setTempToken(data.tempToken);
        setTotpCode("");
      } else {
        completeAuth(data);
      }
    },
    onError: (e: Error) => setError(e.message),
  });

  const verifyMutation = useMutation({
    mutationFn: async () => {
      return apiFetch<any>("/api/auth/2fa/verify", {
        method: "POST",
        body: JSON.stringify({ tempToken, code: totpCode.replace(/\s/g, "") }),
      });
    },
    onSuccess: (data) => completeAuth(data),
    onError: (e: Error) => { setError(e.message); setTotpCode(""); },
  });

  if (tempToken) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-4">
        <div className="w-full max-w-sm">
          <div className="flex justify-center mb-6">
            <ScanBarcode className="w-14 h-14 text-primary" />
          </div>
          <div className="bg-card border border-border rounded-xl p-6 space-y-4">
            <div className="text-center space-y-1">
              <h1 className="text-lg font-semibold flex items-center justify-center gap-2">
                <ShieldCheck className="w-4 h-4" /> Two-Factor Authentication
              </h1>
              <p className="text-sm text-muted-foreground">Enter the 6-digit code from your authenticator app</p>
            </div>
            <form onSubmit={(e) => { e.preventDefault(); verifyMutation.mutate(); }} className="space-y-3">
              <input
                value={totpCode}
                onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, ""))}
                autoFocus
                inputMode="numeric"
                maxLength={6}
                placeholder="000000"
                className="w-full text-center text-2xl tracking-widest font-mono rounded-lg border border-border bg-background py-3"
                data-testid="input-totp-code"
              />
              {error && <p className="text-sm text-destructive" data-testid="text-login-error">{error}</p>}
              <button
                type="submit"
                disabled={totpCode.length !== 6 || verifyMutation.isPending}
                className="w-full bg-primary text-primary-foreground rounded-lg py-3 font-medium disabled:opacity-50 flex items-center justify-center gap-2"
                data-testid="button-verify-2fa"
              >
                {verifyMutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
                Verify
              </button>
              <button
                type="button"
                onClick={() => { setTempToken(null); setTotpCode(""); setError(null); }}
                className="w-full text-muted-foreground text-sm flex items-center justify-center gap-1 py-2"
                data-testid="button-back-to-login"
              >
                <ArrowLeft className="w-4 h-4" /> Back
              </button>
            </form>
          </div>
          {tempToken && (
            <p className="text-center text-xs text-muted-foreground mt-4">
              If this is your first login, complete 2FA setup on the main GlobiPOS site first.
            </p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-6">
          <ScanBarcode className="w-14 h-14 text-primary mb-2" />
          <h1 className="text-xl font-bold">GlobiPOS PDA</h1>
          <p className="text-sm text-muted-foreground">Handheld operations</p>
        </div>
        <div className="bg-card border border-border rounded-xl p-6 space-y-4">
          <h2 className="text-base font-semibold flex items-center gap-2">
            <Lock className="w-4 h-4" /> Staff Sign In
          </h2>
          <form onSubmit={(e) => { e.preventDefault(); loginMutation.mutate(); }} className="space-y-3">
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoFocus
              autoComplete="username"
              placeholder="Username"
              className="w-full rounded-lg border border-border bg-background py-3 px-3 text-base"
              data-testid="input-username"
            />
            <input
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              type="password"
              autoComplete="current-password"
              placeholder="Password"
              className="w-full rounded-lg border border-border bg-background py-3 px-3 text-base"
              data-testid="input-password"
            />
            {error && <p className="text-sm text-destructive" data-testid="text-login-error">{error}</p>}
            <button
              type="submit"
              disabled={loginMutation.isPending}
              className="w-full bg-primary text-primary-foreground rounded-lg py-3 font-medium disabled:opacity-50 flex items-center justify-center gap-2"
              data-testid="button-login"
            >
              {loginMutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
              Sign In
            </button>
          </form>
        </div>
        <p className="text-center text-xs text-muted-foreground mt-6">
          Staff / admin credentials only — private device
        </p>
      </div>
    </div>
  );
}
