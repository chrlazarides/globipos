import { useState } from "react";
import { apiFetch } from "../lib/queryClient";
import { setToken, setCustomer, type CustomerSession } from "../lib/auth";
import { cn } from "../lib/cn";

interface LoginProps {
  onLogin: (c: CustomerSession) => void;
}

type Step = "method" | "email" | "code" | "password";

export default function Login({ onLogin }: LoginProps) {
  const [step, setStep] = useState<Step>("method");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [accessCode, setAccessCode] = useState("");
  const [customerCode, setCustomerCode] = useState("");
  const [otp, setOtp] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleRequestOtp(e: React.FormEvent) {
    e.preventDefault();
    setError(""); setLoading(true);
    try {
      await apiFetch("/api/customer/auth/request-otp", { method: "POST", body: JSON.stringify({ email }) });
      setStep("code");
    } catch (err: any) {
      setError(err.message || "Failed to send code");
    } finally { setLoading(false); }
  }

  async function handleVerifyOtp(e: React.FormEvent) {
    e.preventDefault();
    setError(""); setLoading(true);
    try {
      const data = await apiFetch<{ token: string; customer: CustomerSession }>(
        "/api/customer/auth/verify-otp",
        { method: "POST", body: JSON.stringify({ email, code: otp }) }
      );
      setToken(data.token);
      setCustomer(data.customer);
      onLogin(data.customer);
    } catch (err: any) {
      setError(err.message || "Invalid code");
    } finally { setLoading(false); }
  }

  async function handleCodeLogin(e: React.FormEvent) {
    e.preventDefault();
    setError(""); setLoading(true);
    try {
      const data = await apiFetch<{ token: string; customer: CustomerSession }>(
        "/api/customer/auth/login",
        { method: "POST", body: JSON.stringify({ code: customerCode, accessCode }) }
      );
      setToken(data.token);
      setCustomer(data.customer);
      onLogin(data.customer);
    } catch (err: any) {
      setError(err.message || "Invalid credentials");
    } finally { setLoading(false); }
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm">
        {/* Logo area */}
        <div className="text-center mb-8">
          <div
            className="inline-flex items-center justify-center w-16 h-16 rounded-2xl mb-4"
            style={{ background: "hsl(var(--primary))" }}
          >
            <span className="text-2xl font-bold text-white">G</span>
          </div>
          <h1 className="text-2xl font-bold">GlobiPOS Shop</h1>
          <p className="text-sm text-[hsl(var(--muted-foreground))] mt-1">Sign in to your account</p>
        </div>

        <div className="bg-[hsl(var(--card))] border border-[hsl(var(--border))] rounded-xl p-6 shadow-sm">
          {step === "method" && (
            <div className="space-y-3">
              <h2 className="text-sm font-semibold text-center mb-4">Choose sign-in method</h2>
              <button
                onClick={() => setStep("email")}
                className="w-full py-3 px-4 rounded-lg border border-[hsl(var(--border))] text-sm font-medium hover:bg-[hsl(var(--muted))] transition-colors text-left"
                data-testid="button-login-otp"
              >
                📧 Email one-time code
                <span className="block text-xs text-[hsl(var(--muted-foreground))] font-normal mt-0.5">We'll send a 6-digit code to your email</span>
              </button>
              <button
                onClick={() => setStep("password")}
                className="w-full py-3 px-4 rounded-lg border border-[hsl(var(--border))] text-sm font-medium hover:bg-[hsl(var(--muted))] transition-colors text-left"
                data-testid="button-login-code"
              >
                🔑 Customer code + access code
                <span className="block text-xs text-[hsl(var(--muted-foreground))] font-normal mt-0.5">Use your customer code and portal password</span>
              </button>
            </div>
          )}

          {step === "email" && (
            <form onSubmit={handleRequestOtp} className="space-y-4">
              <div>
                <label className="block text-xs font-medium mb-1">Email address</label>
                <input
                  type="email"
                  required
                  autoFocus
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="your@email.com"
                  className="w-full px-3 py-2 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] text-sm focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary))]"
                  data-testid="input-login-email"
                />
              </div>
              {error && <p className="text-xs text-red-500">{error}</p>}
              <button
                type="submit"
                disabled={loading}
                className="w-full py-2.5 rounded-lg text-sm font-medium text-white transition-opacity disabled:opacity-60"
                style={{ background: "hsl(var(--primary))" }}
                data-testid="button-send-code"
              >
                {loading ? "Sending…" : "Send login code"}
              </button>
              <button type="button" onClick={() => { setStep("method"); setError(""); }} className="w-full text-xs text-[hsl(var(--muted-foreground))] py-1 hover:underline">
                ← Back
              </button>
            </form>
          )}

          {step === "code" && (
            <form onSubmit={handleVerifyOtp} className="space-y-4">
              <div className="text-center mb-2">
                <p className="text-sm text-[hsl(var(--muted-foreground))]">Code sent to</p>
                <p className="font-medium text-sm">{email}</p>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">6-digit code</label>
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  required
                  autoFocus
                  value={otp}
                  onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  placeholder="000000"
                  className="w-full px-3 py-3 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] text-2xl text-center tracking-widest font-mono focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary))]"
                  data-testid="input-otp-code"
                />
              </div>
              {error && <p className="text-xs text-red-500">{error}</p>}
              <button
                type="submit"
                disabled={loading || otp.length !== 6}
                className="w-full py-2.5 rounded-lg text-sm font-medium text-white transition-opacity disabled:opacity-60"
                style={{ background: "hsl(var(--primary))" }}
                data-testid="button-verify-otp"
              >
                {loading ? "Verifying…" : "Sign in"}
              </button>
              <button type="button" onClick={() => { setStep("email"); setOtp(""); setError(""); }} className="w-full text-xs text-[hsl(var(--muted-foreground))] py-1 hover:underline">
                Resend or use different email
              </button>
            </form>
          )}

          {step === "password" && (
            <form onSubmit={handleCodeLogin} className="space-y-4">
              <div>
                <label className="block text-xs font-medium mb-1">Customer Code</label>
                <input
                  type="text"
                  required
                  autoFocus
                  value={customerCode}
                  onChange={(e) => setCustomerCode(e.target.value.toUpperCase())}
                  placeholder="e.g. CUST001"
                  className="w-full px-3 py-2 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] text-sm font-mono uppercase focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary))]"
                  data-testid="input-customer-code"
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Access Code</label>
                <input
                  type="password"
                  required
                  value={accessCode}
                  onChange={(e) => setAccessCode(e.target.value)}
                  placeholder="Portal password"
                  className="w-full px-3 py-2 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] text-sm focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary))]"
                  data-testid="input-access-code"
                />
              </div>
              {error && <p className="text-xs text-red-500">{error}</p>}
              <button
                type="submit"
                disabled={loading}
                className="w-full py-2.5 rounded-lg text-sm font-medium text-white transition-opacity disabled:opacity-60"
                style={{ background: "hsl(var(--primary))" }}
                data-testid="button-login-submit"
              >
                {loading ? "Signing in…" : "Sign in"}
              </button>
              <button type="button" onClick={() => { setStep("method"); setError(""); }} className="w-full text-xs text-[hsl(var(--muted-foreground))] py-1 hover:underline">
                ← Back
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
