import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { Trophy, Star, TrendingUp, Gift } from "lucide-react";
import { formatDate } from "@/lib/utils";
import type { Customer } from "@shared/schema";

interface PortalLoyaltyProps {
  customer: Customer;
}

function tierColor(tier: string) {
  switch (tier) {
    case "Gold":   return "bg-yellow-100 text-yellow-800 border-yellow-300 dark:bg-yellow-900/50 dark:text-yellow-200";
    case "Silver": return "bg-slate-100 text-slate-800 border-slate-300 dark:bg-slate-800 dark:text-slate-200";
    default:       return "bg-orange-100 text-orange-800 border-orange-300 dark:bg-orange-900/50 dark:text-orange-200";
  }
}

export default function PortalLoyalty({ customer }: PortalLoyaltyProps) {
  const { data, isLoading } = useQuery<any>({
    queryKey: ["/api/portal/customer", customer.id, "loyalty"],
  });

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-48" />
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-28" />)}
        </div>
        <Skeleton className="h-64" />
      </div>
    );
  }

  if (!data) return null;

  const { balance, earned, redeemed, tier, nextTier, history } = data;
  const progressPct = nextTier ? Math.min(100, (balance / nextTier.threshold) * 100) : 100;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold" data-testid="text-portal-loyalty-title">Loyalty Rewards</h1>
        <p className="text-sm text-muted-foreground mt-1">Earn 1 point for every €1 you spend on orders</p>
      </div>

      <Card className="overflow-hidden">
        <div className="bg-gradient-to-r from-primary/90 to-primary p-6 text-white">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <p className="text-sm font-medium opacity-80">Points Balance</p>
              <p className="text-4xl font-bold mt-1 tabular-nums" data-testid="stat-loyalty-balance">
                {Number(balance).toLocaleString()}
              </p>
              <p className="text-sm opacity-70 mt-1">points</p>
            </div>
            <div className="flex flex-col items-end gap-2">
              <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-semibold border ${tierColor(tier)}`} data-testid="badge-loyalty-tier">
                <Trophy className="w-3.5 h-3.5" />
                {tier} Member
              </span>
              {nextTier && (
                <span className="text-xs opacity-80">
                  {(nextTier.threshold - balance).toLocaleString()} pts to {nextTier.name}
                </span>
              )}
            </div>
          </div>
          {nextTier && (
            <div className="mt-4">
              <div className="flex justify-between text-xs opacity-70 mb-1.5">
                <span>{tier}</span>
                <span>{nextTier.name} ({nextTier.threshold.toLocaleString()} pts)</span>
              </div>
              <div className="w-full bg-white/20 rounded-full h-2">
                <div className="bg-white h-2 rounded-full transition-all" style={{ width: `${progressPct}%` }} />
              </div>
            </div>
          )}
        </div>
      </Card>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="flex items-center justify-center w-9 h-9 rounded-md bg-green-100 dark:bg-green-900/30">
              <TrendingUp className="w-4 h-4 text-green-600 dark:text-green-400" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Total Earned</p>
              <p className="text-xl font-bold tabular-nums" data-testid="stat-loyalty-earned">{Number(earned).toLocaleString()}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="flex items-center justify-center w-9 h-9 rounded-md bg-blue-100 dark:bg-blue-900/30">
              <Gift className="w-4 h-4 text-blue-600 dark:text-blue-400" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Total Redeemed</p>
              <p className="text-xl font-bold tabular-nums" data-testid="stat-loyalty-redeemed">{Number(redeemed).toLocaleString()}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="flex items-center justify-center w-9 h-9 rounded-md bg-purple-100 dark:bg-purple-900/30">
              <Star className="w-4 h-4 text-purple-600 dark:text-purple-400" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Tier Status</p>
              <p className="text-xl font-bold" data-testid="stat-loyalty-tier">{tier}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="p-4 pb-2">
          <h3 className="text-sm font-semibold">Points History</h3>
        </CardHeader>
        <CardContent className="p-4 pt-0">
          {!history || history.length === 0 ? (
            <div className="flex flex-col items-center py-10 text-muted-foreground">
              <Star className="w-8 h-8 mb-2 opacity-30" />
              <p className="text-sm">No points earned yet — start ordering to earn rewards!</p>
            </div>
          ) : (
            <div className="divide-y">
              {history.map((h: any) => (
                <div key={h.id} className="flex items-center justify-between gap-2 py-2.5 text-sm" data-testid={`row-loyalty-${h.id}`}>
                  <div>
                    <p className="font-medium">{h.reason || h.type}</p>
                    <p className="text-xs text-muted-foreground">{formatDate(h.createdAt)}</p>
                  </div>
                  <span className={`font-bold tabular-nums ${Number(h.points) > 0 ? "text-green-600 dark:text-green-400" : "text-red-500"}`}>
                    {Number(h.points) > 0 ? "+" : ""}{Number(h.points).toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="p-4 pb-2">
          <h3 className="text-sm font-semibold">Tier Benefits</h3>
        </CardHeader>
        <CardContent className="p-4 pt-0">
          <div className="space-y-3">
            {[
              { name: "Bronze", threshold: 0,    benefit: "1 point per €1 spent on every order" },
              { name: "Silver", threshold: 1000,  benefit: "Priority order processing + exclusive seasonal offers" },
              { name: "Gold",   threshold: 5000,  benefit: "Dedicated account manager + best pricing tier access" },
            ].map((t) => (
              <div
                key={t.name}
                className={`flex items-start gap-3 p-3 rounded-lg border transition-colors ${tier === t.name ? "border-primary bg-primary/5" : "border-border"}`}
                data-testid={`card-tier-${t.name.toLowerCase()}`}
              >
                <div className={`flex items-center justify-center w-7 h-7 rounded-full text-xs font-bold flex-shrink-0 border ${tierColor(t.name)}`}>
                  {t.name[0]}
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold">
                    {t.name}
                    {tier === t.name && <span className="text-xs font-normal text-primary ml-2">(current)</span>}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {t.threshold > 0 ? `${t.threshold.toLocaleString()}+ points — ` : ""}{t.benefit}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
