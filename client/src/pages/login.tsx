import { useState } from "react";
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
import { Wine, Lock, Loader2, Eye, EyeOff, ShieldCheck, ArrowLeft } from "lucide-react";

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
  const [tempToken, setTempToken] = useState<string | null>(null);
  const [pendingUsername, setPendingUsername] = useState("");
  const [totpCode, setTotpCode] = useState("");

  const loginForm = useForm<LoginForm>({
    resolver: zodResolver(loginSchema),
    defaultValues: { username: "", password: "" },
  });

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

  const logo = (
    <div className="flex justify-center mb-8">
      <div className="flex items-center gap-3">
        <div className="w-12 h-12 flex items-center justify-center rounded-xl bg-primary text-primary-foreground">
          <Wine className="w-6 h-6" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-foreground">VinTrade</h1>
          <p className="text-xs text-muted-foreground">Wholesale Management</p>
        </div>
      </div>
    </div>
  );

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
