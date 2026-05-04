import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Wine, Lock, Loader2, Eye, EyeOff, ShieldCheck, ArrowLeft, ScanLine } from "lucide-react";

const loginSchema = z.object({
  username: z.string().min(1, "Username is required"),
  password: z.string().min(1, "Password is required"),
});

type LoginForm = z.infer<typeof loginSchema>;

interface LoginPageProps {
  onLogin: (user: { id: string; username: string; role: string }) => void;
}

export default function LoginPage({ onLogin }: LoginPageProps) {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [showPassword, setShowPassword] = useState(false);

  // 2FA verify state (existing users with 2FA already enabled)
  const [tempToken, setTempToken] = useState<string | null>(null);
  const [pendingUsername, setPendingUsername] = useState("");
  const [totpCode, setTotpCode] = useState("");

  // 2FA forced setup state (first login — user has no 2FA yet)
  const [setupToken, setSetupToken] = useState<string | null>(null);
  const [setupQr, setSetupQr] = useState<string | null>(null);
  const [setupSecret, setSetupSecret] = useState<string | null>(null);
  const [setupCode, setSetupCode] = useState("");
  const [loadingQr, setLoadingQr] = useState(false);

  const loginForm = useForm<LoginForm>({
    resolver: zodResolver(loginSchema),
    defaultValues: { username: "", password: "" },
  });

  // Fetch the QR code as soon as we enter setup mode
  useEffect(() => {
    if (!setupToken) return;
    setLoadingQr(true);
    fetch(`/api/auth/2fa/setup-initial?token=${setupToken}`)
      .then(r => r.json())
      .then(data => {
        if (data.qrDataUrl) {
          setSetupQr(data.qrDataUrl);
          setSetupSecret(data.secret);
        } else {
          toast({ title: "Setup failed", description: data.message || "Could not generate QR code", variant: "destructive" });
          setSetupToken(null);
        }
      })
      .catch(() => {
        toast({ title: "Setup failed", description: "Network error", variant: "destructive" });
        setSetupToken(null);
      })
      .finally(() => setLoadingQr(false));
  }, [setupToken]);

  const loginMutation = useMutation({
    mutationFn: async (data: LoginForm) => {
      const res = await apiRequest("POST", "/api/auth/login", data);
      return res.json();
    },
    onSuccess: (data) => {
      if (data.requires2fa) {
        setTempToken(data.tempToken);
        setPendingUsername(loginForm.getValues("username"));
        setTotpCode("");
      } else if (data.requires2faSetup) {
        setPendingUsername(loginForm.getValues("username"));
        setSetupToken(data.tempToken);
        setSetupCode("");
      } else {
        onLogin(data);
        setLocation("/");
      }
    },
    onError: (err: Error) => {
      toast({ title: "Login failed", description: err.message, variant: "destructive" });
    },
  });

  const totpMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/auth/2fa/verify", {
        tempToken,
        code: totpCode.replace(/\s/g, ""),
      });
      return res.json();
    },
    onSuccess: (user) => {
      onLogin(user);
      setLocation("/");
    },
    onError: (err: Error) => {
      toast({ title: "Verification failed", description: err.message, variant: "destructive" });
      setTotpCode("");
    },
  });

  const setupMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/auth/2fa/setup-initial", {
        tempToken: setupToken,
        code: setupCode.replace(/\s/g, ""),
      });
      return res.json();
    },
    onSuccess: (user) => {
      toast({ title: "2FA enabled", description: "Your account is now protected with two-factor authentication." });
      onLogin(user);
      setLocation("/");
    },
    onError: (err: Error) => {
      toast({ title: "Verification failed", description: err.message, variant: "destructive" });
      setSetupCode("");
    },
  });

  const logo = (
    <div className="flex justify-center mb-8">
      <img src="/logo.png" alt="Gastro Nobile" className="h-20 w-auto object-contain" />
    </div>
  );

  // ── Screen: forced 2FA setup (first login) ──────────────────────────────────
  if (setupToken) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-4">
        <div className="w-full max-w-sm">
          {logo}
          <Card>
            <CardHeader className="text-center pb-2">
              <CardTitle className="text-lg flex items-center justify-center gap-2">
                <ScanLine className="w-4 h-4" />
                Set Up Two-Factor Authentication
              </CardTitle>
              <CardDescription>
                This system requires 2FA. Scan the QR code with your authenticator app (Google Authenticator, Authy, etc.), then enter the 6-digit code to activate.
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-2 space-y-4">
              {loadingQr ? (
                <div className="flex justify-center py-6">
                  <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
                </div>
              ) : setupQr ? (
                <>
                  <div className="flex justify-center">
                    <img src={setupQr} alt="2FA QR Code" className="w-48 h-48 rounded-lg border" data-testid="img-setup-qr" />
                  </div>
                  <div className="text-center">
                    <p className="text-xs text-muted-foreground mb-1">Or enter this key manually:</p>
                    <code className="block text-xs bg-muted rounded p-2 break-all font-mono select-all" data-testid="text-setup-secret">
                      {setupSecret}
                    </code>
                  </div>
                  <form onSubmit={e => { e.preventDefault(); setupMutation.mutate(); }} className="space-y-3">
                    <div className="space-y-1.5">
                      <label className="text-sm font-medium" htmlFor="setup-totp-code">Enter the 6-digit code to confirm</label>
                      <Input
                        id="setup-totp-code"
                        value={setupCode}
                        onChange={e => setSetupCode(e.target.value.replace(/\D/g, ""))}
                        autoFocus
                        autoComplete="one-time-code"
                        inputMode="numeric"
                        maxLength={6}
                        placeholder="000000"
                        className="text-center text-2xl tracking-widest font-mono"
                        data-testid="input-setup-totp-code"
                      />
                    </div>
                    <Button
                      type="submit"
                      className="w-full"
                      disabled={setupCode.length !== 6 || setupMutation.isPending}
                      data-testid="button-activate-2fa"
                    >
                      {setupMutation.isPending ? (
                        <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Activating...</>
                      ) : "Activate & Sign In"}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      className="w-full text-muted-foreground"
                      onClick={() => { setSetupToken(null); setSetupQr(null); setSetupSecret(null); setSetupCode(""); loginForm.reset(); }}
                      data-testid="button-back-from-setup"
                    >
                      <ArrowLeft className="w-4 h-4 mr-2" />
                      Back to login
                    </Button>
                  </form>
                </>
              ) : null}
            </CardContent>
          </Card>
          <p className="text-center text-xs text-muted-foreground mt-6">
            Private system — unauthorised access is prohibited
          </p>
        </div>
      </div>
    );
  }

  // ── Screen: 2FA verify (existing users) ────────────────────────────────────
  if (tempToken) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-4">
        <div className="w-full max-w-sm">
          {logo}
          <Card>
            <CardHeader className="text-center pb-2">
              <CardTitle className="text-lg flex items-center justify-center gap-2">
                <ShieldCheck className="w-4 h-4" />
                Two-Factor Authentication
              </CardTitle>
              <CardDescription>
                Open your authenticator app and enter the 6-digit code for <strong>{pendingUsername}</strong>
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-4">
              <form onSubmit={e => { e.preventDefault(); totpMutation.mutate(); }} className="space-y-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium" htmlFor="totp-login-code">Authentication Code</label>
                  <Input
                    id="totp-login-code"
                    value={totpCode}
                    onChange={e => setTotpCode(e.target.value.replace(/\D/g, ""))}
                    autoFocus
                    autoComplete="one-time-code"
                    inputMode="numeric"
                    maxLength={6}
                    placeholder="000000"
                    className="text-center text-2xl tracking-widest font-mono"
                    data-testid="input-totp-code"
                  />
                </div>
                <Button
                  type="submit"
                  className="w-full"
                  disabled={totpCode.length !== 6 || totpMutation.isPending}
                  data-testid="button-verify-2fa"
                >
                  {totpMutation.isPending ? (
                    <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Verifying...</>
                  ) : "Verify"}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  className="w-full text-muted-foreground"
                  onClick={() => { setTempToken(null); setTotpCode(""); loginForm.reset(); }}
                  data-testid="button-back-to-login"
                >
                  <ArrowLeft className="w-4 h-4 mr-2" />
                  Back to login
                </Button>
              </form>
            </CardContent>
          </Card>
          <p className="text-center text-xs text-muted-foreground mt-6">
            Private system — unauthorised access is prohibited
          </p>
        </div>
      </div>
    );
  }

  // ── Screen: username/password ───────────────────────────────────────────────
  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm">
        {logo}
        <Card>
          <CardHeader className="text-center pb-2">
            <CardTitle className="text-lg flex items-center justify-center gap-2">
              <Lock className="w-4 h-4" />
              Sign In
            </CardTitle>
            <CardDescription>Enter your credentials to access the system</CardDescription>
          </CardHeader>
          <CardContent className="pt-4">
            <Form {...loginForm}>
              <form onSubmit={loginForm.handleSubmit((d) => loginMutation.mutate(d))} className="space-y-4">
                <FormField
                  control={loginForm.control}
                  name="username"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Username</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          autoComplete="username"
                          autoFocus
                          data-testid="input-username"
                          placeholder="Enter your username"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={loginForm.control}
                  name="password"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Password</FormLabel>
                      <FormControl>
                        <div className="relative">
                          <Input
                            {...field}
                            type={showPassword ? "text" : "password"}
                            autoComplete="current-password"
                            data-testid="input-password"
                            placeholder="Enter your password"
                            className="pr-10"
                          />
                          <button
                            type="button"
                            onClick={() => setShowPassword(!showPassword)}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                            tabIndex={-1}
                          >
                            {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                          </button>
                        </div>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <Button type="submit" className="w-full" disabled={loginMutation.isPending} data-testid="button-login">
                  {loginMutation.isPending ? (
                    <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Signing in...</>
                  ) : "Sign In"}
                </Button>
              </form>
            </Form>
          </CardContent>
        </Card>

        <p className="text-center text-xs text-muted-foreground mt-6">
          Private system — unauthorised access is prohibited
        </p>
      </div>
    </div>
  );
}
