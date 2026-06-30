import { useQuery } from "@tanstack/react-query";
import { type CustomerSession } from "../lib/auth";
import { Trophy, TrendingUp, Gift, Star } from "lucide-react";

interface LoyaltyProps { customer: CustomerSession; }

function tierColor(tier: string): string {
  if (tier === "Gold")   return "bg-yellow-100 text-yellow-800 border-yellow-300 dark:bg-yellow-900/40 dark:text-yellow-200";
  if (tier === "Silver") return "bg-slate-100 text-slate-800 border-slate-300 dark:bg-slate-800 dark:text-slate-200";
  return "bg-orange-100 text-orange-800 border-orange-300 dark:bg-orange-900/40 dark:text-orange-200";
}

function formatDate(d: string) {
  return new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

export default function Loyalty({ customer }: LoyaltyProps) {
  const { data, isLoading } = useQuery<any>({ queryKey: ["/api/customer/loyalty"] });

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="h-36 rounded-xl bg-[hsl(var(--muted))] animate-pulse" />
        <div className="grid grid-cols-3 gap-3">
          {Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-20 rounded-xl bg-[hsl(var(--muted))] animate-pulse" />)}
        </div>
        <div className="h-48 rounded-xl bg-[hsl(var(--muted))] animate-pulse" />
      </div>
    );
  }

  if (!data) return null;

  const { balance, earned, redeemed, tier, nextTier, history } = data;
  const progressPct = nextTier ? Math.min(100, (balance / nextTier.threshold) * 100) : 100;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Loyalty Rewards</h1>
        <p className="text-xs text-[hsl(var(--muted-foreground))] mt-0.5">Earn 1 point per €1 spent</p>
      </div>

      {/* Hero card */}
      <div className="rounded-xl overflow-hidden" style={{ background: "linear-gradient(135deg, hsl(var(--primary)/90%), hsl(var(--primary)))" }}>
        <div className="p-5 text-white">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs opacity-75">Your Balance</p>
              <p className="text-4xl font-bold mt-1 tabular-nums" data-testid="stat-loyalty-balance">
                {Number(balance).toLocaleString()}
              </p>
              <p className="text-xs opacity-70">points</p>
            </div>
            <span className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-semibold border ${tierColor(tier)}`} data-testid="badge-loyalty-tier">
              <Trophy className="w-3 h-3" /> {tier}
            </span>
          </div>
          {nextTier && (
            <div className="mt-4">
              <div className="flex justify-between text-xs opacity-70 mb-1">
                <span>{tier}</span>
                <span>{nextTier.name}</span>
              </div>
              <div className="w-full bg-white/25 rounded-full h-1.5">
                <div className="bg-white h-1.5 rounded-full transition-all" style={{ width: `${progressPct}%` }} />
              </div>
              <p className="text-xs opacity-70 mt-1">
                {(nextTier.threshold - balance).toLocaleString()} pts to {nextTier.name}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-2">
        {[
          { label: "Earned", value: earned, icon: TrendingUp, color: "text-green-600" },
          { label: "Redeemed", value: redeemed, icon: Gift, color: "text-blue-600" },
          { label: "Tier", value: tier, icon: Star, color: "text-purple-600", isText: true },
        ].map((stat) => (
          <div key={stat.label} className="bg-[hsl(var(--card))] border border-[hsl(var(--border))] rounded-xl p-3 text-center">
            <stat.icon className={`w-4 h-4 mx-auto mb-1 ${stat.color}`} />
            <p className="text-xs text-[hsl(var(--muted-foreground))]">{stat.label}</p>
            <p className="text-sm font-bold mt-0.5">
              {stat.isText ? String(stat.value) : Number(stat.value).toLocaleString()}
            </p>
          </div>
        ))}
      </div>

      {/* History */}
      <div className="bg-[hsl(var(--card))] border border-[hsl(var(--border))] rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-[hsl(var(--border))]">
          <h3 className="text-sm font-semibold">Points History</h3>
        </div>
        {!history?.length ? (
          <div className="flex flex-col items-center py-10 text-[hsl(var(--muted-foreground))]">
            <Star className="w-8 h-8 mb-2 opacity-30" />
            <p className="text-xs">No points yet — start ordering!</p>
          </div>
        ) : (
          <div className="divide-y divide-[hsl(var(--border))]">
            {history.map((h: any) => (
              <div key={h.id} className="flex items-center justify-between px-4 py-3 gap-2">
                <div>
                  <p className="text-xs font-medium">{h.reason || h.type}</p>
                  <p className="text-[10px] text-[hsl(var(--muted-foreground))]">{formatDate(h.createdAt)}</p>
                </div>
                <span className={`text-sm font-bold tabular-nums ${Number(h.points) > 0 ? "text-green-600 dark:text-green-400" : "text-red-500"}`}>
                  {Number(h.points) > 0 ? "+" : ""}{Number(h.points).toLocaleString()}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Tier guide */}
      <div className="bg-[hsl(var(--card))] border border-[hsl(var(--border))] rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-[hsl(var(--border))]">
          <h3 className="text-sm font-semibold">Tier Benefits</h3>
        </div>
        <div className="divide-y divide-[hsl(var(--border))]">
          {[
            { name: "Bronze", pts: 0,    benefit: "1 pt per €1" },
            { name: "Silver", pts: 1000, benefit: "Priority processing + seasonal offers" },
            { name: "Gold",   pts: 5000, benefit: "Dedicated manager + best pricing" },
          ].map((t) => (
            <div key={t.name} className={`flex items-center gap-3 px-4 py-3 ${tier === t.name ? "bg-[hsl(var(--primary))]/5" : ""}`}>
              <span className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold border flex-shrink-0 ${tierColor(t.name)}`}>
                {t.name[0]}
              </span>
              <div>
                <p className="text-xs font-semibold">
                  {t.name}
                  {tier === t.name && <span className="text-[10px] text-[hsl(var(--primary))] font-normal ml-1">(you)</span>}
                </p>
                <p className="text-[10px] text-[hsl(var(--muted-foreground))]">
                  {t.pts > 0 ? `${t.pts.toLocaleString()}+ pts — ` : ""}{t.benefit}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
