import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Trophy, Star, TrendingUp, Gift, Wallet, ArrowRight, CheckCircle2 } from "lucide-react";
import { formatDate } from "@/lib/utils";
import { getPortalQueryFn, portalApiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Customer } from "@shared/schema";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

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
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isRedeemOpen, setIsRedeemOpen] = useState(false);
  const [pointsToRedeem, setPointsToRedeem] = useState<number | "">("");

  const { data, isLoading } = useQuery<any>({
    queryKey: ["/api/portal/customer", customer.id, "loyalty"],
    queryFn: getPortalQueryFn(`/api/portal/customer/${customer.id}/loyalty`),
  });

  const redeemMutation = useMutation({
    mutationFn: async (points: number) => {
      const res = await portalApiRequest("POST", `/api/portal/customer/${customer.id}/loyalty/redeem`, {
        points,
        redemptionKey: crypto.randomUUID(),
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/portal/customer", customer.id, "loyalty"] });
      toast({
        title: "Points Redeemed!",
        description: "Your Cash Back balance has been updated.",
      });
      setIsRedeemOpen(false);
      setPointsToRedeem("");
    },
    onError: (err: Error) => {
      toast({
        title: "Redemption Failed",
        description: err.message,
        variant: "destructive",
      });
    },
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

  const {
    balance = 0,
    earned = 0,
    redeemed = 0,
    tier = "Bronze",
    nextTier,
    loyaltyPointsPerEuro = 1,
    history = [],
    cashbackBalance = 0,
    cashbackRate = 0.05,
    loyaltyEnabled = true,
    cashbackEnabled = true,
    redeemPointsPerEuro = 100,
    minimumRedemptionPoints = 500,
    silverThreshold = 1000,
    goldThreshold = 5000,
    cashbackRates = { bronze: 0, silver: 0, gold: 0 },
  } = data;

  const progressPct = nextTier ? Math.min(100, (balance / nextTier.threshold) * 100) : 100;
  const pointLabel = Number(loyaltyPointsPerEuro) === 1 ? "point" : "points";
  const fmtCurrency = (v: number) => `€${v.toLocaleString("el-CY", { minimumFractionDigits: 2 })}`;

  const handleRedeem = () => {
    const pts = Number(pointsToRedeem);
    if (isNaN(pts) || pts < minimumRedemptionPoints) {
      toast({ title: "Invalid amount", description: `Minimum redemption is ${minimumRedemptionPoints} points.`, variant: "destructive" });
      return;
    }
    if (pts % redeemPointsPerEuro !== 0) {
      toast({ title: "Invalid amount", description: `Points must be in multiples of ${redeemPointsPerEuro}.`, variant: "destructive" });
      return;
    }
    if (pts > balance) {
      toast({ title: "Insufficient points", description: "You don't have enough points.", variant: "destructive" });
      return;
    }
    redeemMutation.mutate(pts);
  };

  const potentialCashback = !isNaN(Number(pointsToRedeem)) && Number(pointsToRedeem) >= minimumRedemptionPoints
    ? (Number(pointsToRedeem) / redeemPointsPerEuro)
    : 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground" data-testid="text-portal-loyalty-title">Rewards & Cash Back</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Earn {loyaltyPointsPerEuro} {pointLabel} for every €1 spent. Redeem points for Cash Back.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Points Card */}
        <Card className="overflow-hidden border-0 shadow-lg relative bg-gradient-to-br from-indigo-600 via-indigo-700 to-violet-800 text-white">
          <div className="absolute top-0 right-0 p-6 opacity-10">
            <Trophy className="w-32 h-32" />
          </div>
          <CardContent className="p-6 relative z-10 flex flex-col h-full justify-between gap-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-indigo-100 uppercase tracking-wider">Loyalty Points</p>
                <p className="text-5xl font-black mt-2 tracking-tight tabular-nums" data-testid="stat-loyalty-balance">
                  {Number(balance).toLocaleString()}
                </p>
              </div>
              <div className="flex flex-col items-end gap-2">
                <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider shadow-sm ${tierColor(tier)}`} data-testid="badge-loyalty-tier">
                  <Star className="w-3.5 h-3.5 fill-current" />
                  {tier}
                </span>
              </div>
            </div>

            {loyaltyEnabled && cashbackEnabled && (
              <div className="flex items-center justify-between gap-4">
                <Button
                  variant="secondary"
                  className="bg-white/20 hover:bg-white/30 text-white border-0"
                  onClick={() => setIsRedeemOpen(true)}
                  disabled={balance < minimumRedemptionPoints}
                  data-testid="button-open-redeem"
                >
                  Redeem Points
                </Button>
                {balance < minimumRedemptionPoints && (
                  <p className="text-xs text-indigo-200">
                    Need {minimumRedemptionPoints.toLocaleString()} pts to redeem
                  </p>
                )}
              </div>
            )}

            {nextTier && (
              <div className="mt-2">
                <div className="flex justify-between text-xs text-indigo-200 mb-2 font-medium">
                  <span>{tier}</span>
                  <span>{nextTier.name} ({(nextTier.threshold - balance).toLocaleString()} pts to go)</span>
                </div>
                <Progress value={progressPct} className="h-1.5 bg-black/20" />
              </div>
            )}
          </CardContent>
        </Card>

        {/* Cash Back Card */}
        <Card className="overflow-hidden border-0 shadow-lg relative bg-gradient-to-br from-emerald-500 via-emerald-600 to-teal-700 text-white">
          <div className="absolute top-0 right-0 p-6 opacity-10">
            <Wallet className="w-32 h-32" />
          </div>
          <CardContent className="p-6 relative z-10 flex flex-col h-full justify-between gap-6">
            <div>
              <p className="text-sm font-medium text-emerald-100 uppercase tracking-wider">Available Cash Back</p>
              <p className="text-5xl font-black mt-2 tracking-tight tabular-nums" data-testid="stat-cashback-balance">
                {fmtCurrency(cashbackBalance)}
              </p>
            </div>

            <div>
              <p className="text-sm text-emerald-50 max-w-[200px] leading-relaxed">
                Use your Cash Back balance at checkout to get discounts on your orders.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Card className="shadow-sm">
          <CardContent className="p-5 flex items-center gap-4">
            <div className="flex items-center justify-center w-12 h-12 rounded-full bg-blue-50 dark:bg-blue-900/30">
              <TrendingUp className="w-6 h-6 text-blue-600 dark:text-blue-400" />
            </div>
            <div>
              <p className="text-sm font-medium text-muted-foreground">Total Points Earned</p>
              <p className="text-2xl font-bold tabular-nums" data-testid="stat-loyalty-earned">{Number(earned).toLocaleString()}</p>
            </div>
          </CardContent>
        </Card>
        <Card className="shadow-sm">
          <CardContent className="p-5 flex items-center gap-4">
            <div className="flex items-center justify-center w-12 h-12 rounded-full bg-purple-50 dark:bg-purple-900/30">
              <Gift className="w-6 h-6 text-purple-600 dark:text-purple-400" />
            </div>
            <div>
              <p className="text-sm font-medium text-muted-foreground">Total Points Redeemed</p>
              <p className="text-2xl font-bold tabular-nums" data-testid="stat-loyalty-redeemed">{Number(redeemed).toLocaleString()}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle>History</CardTitle>
          <CardDescription>Your recent points activity</CardDescription>
        </CardHeader>
        <CardContent>
          {!history || history.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground bg-muted/20 rounded-lg border border-dashed">
              <Star className="w-10 h-10 mb-3 opacity-20" />
              <p className="text-sm font-medium">No points history yet</p>
              <p className="text-xs mt-1">Start placing orders to earn rewards!</p>
            </div>
          ) : (
            <div className="divide-y">
              {history.map((h: any) => (
                <div key={h.id} className="flex items-center justify-between gap-3 py-3" data-testid={`row-loyalty-${h.id}`}>
                  <div className="flex flex-col">
                    <span className="text-sm font-semibold">{h.reason || h.type}</span>
                    <span className="text-xs text-muted-foreground">{formatDate(h.createdAt)}</span>
                  </div>
                  <Badge variant={Number(h.points) > 0 ? "default" : "secondary"} className={Number(h.points) > 0 ? "bg-green-500 hover:bg-green-600" : ""}>
                    {Number(h.points) > 0 ? "+" : ""}{Number(h.points).toLocaleString()}
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle>Tier Benefits</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {[
              { name: "Bronze", threshold: 0, benefit: `${(cashbackRates.bronze * 100).toFixed(1)}% Cash Back` },
              { name: "Silver", threshold: silverThreshold, benefit: `${(cashbackRates.silver * 100).toFixed(1)}% Cash Back` },
              { name: "Gold", threshold: goldThreshold, benefit: `${(cashbackRates.gold * 100).toFixed(1)}% Cash Back` },
            ].map((t) => (
              <div
                key={t.name}
                className={`flex flex-col p-4 rounded-xl border-2 transition-all ${tier === t.name ? "border-indigo-500 bg-indigo-50/50 dark:bg-indigo-500/10 shadow-sm" : "border-transparent bg-muted/40"}`}
                data-testid={`card-tier-${t.name.toLowerCase()}`}
              >
                <div className="flex items-center gap-2 mb-2">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm border ${tierColor(t.name)}`}>
                    {t.name[0]}
                  </div>
                  <span className="font-semibold">{t.name}</span>
                  {tier === t.name && (
                    <CheckCircle2 className="w-4 h-4 text-indigo-500 ml-auto" />
                  )}
                </div>
                <div className="text-xs text-muted-foreground mt-auto">
                  {t.threshold > 0 && <span className="font-medium text-foreground block mb-1">{t.threshold.toLocaleString()}+ points</span>}
                  {t.benefit}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Dialog open={isRedeemOpen} onOpenChange={setIsRedeemOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Redeem Points</DialogTitle>
            <DialogDescription>
              Convert your loyalty points into Cash Back to use on your next order.
            </DialogDescription>
          </DialogHeader>

          <div className="py-4 space-y-4">
            <div className="flex justify-between items-center p-3 bg-muted rounded-lg text-sm">
              <span className="text-muted-foreground">Available Points</span>
              <span className="font-bold">{balance.toLocaleString()}</span>
            </div>

            <div className="space-y-2">
              <Label>Points to Redeem</Label>
              <Input
                type="number"
                placeholder={`Min ${minimumRedemptionPoints}, step ${redeemPointsPerEuro}`}
                value={pointsToRedeem}
                onChange={(e) => setPointsToRedeem(e.target.value ? Number(e.target.value) : "")}
                step={redeemPointsPerEuro}
                min={minimumRedemptionPoints}
                max={balance}
                data-testid="input-redeem-points"
              />
              <p className="text-xs text-muted-foreground">
                Minimum: {minimumRedemptionPoints.toLocaleString()} points. Must be a multiple of {redeemPointsPerEuro.toLocaleString()}.
              </p>
            </div>

            {potentialCashback > 0 && (
              <div className="flex items-center gap-4 justify-center py-4 bg-emerald-50 dark:bg-emerald-950/30 rounded-lg border border-emerald-100 dark:border-emerald-900/50">
                <div className="text-center">
                  <p className="text-xs font-medium text-emerald-600 dark:text-emerald-400 uppercase">You redeem</p>
                  <p className="text-xl font-bold">{Number(pointsToRedeem).toLocaleString()} pts</p>
                </div>
                <ArrowRight className="w-5 h-5 text-emerald-300" />
                <div className="text-center">
                  <p className="text-xs font-medium text-emerald-600 dark:text-emerald-400 uppercase">You get</p>
                  <p className="text-xl font-bold text-emerald-700 dark:text-emerald-300">{fmtCurrency(potentialCashback)}</p>
                </div>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsRedeemOpen(false)}>Cancel</Button>
            <Button
              onClick={handleRedeem}
              disabled={redeemMutation.isPending || !pointsToRedeem || Number(pointsToRedeem) < minimumRedemptionPoints || Number(pointsToRedeem) > balance || Number(pointsToRedeem) % redeemPointsPerEuro !== 0}
              data-testid="button-confirm-redeem"
            >
              {redeemMutation.isPending ? "Redeeming..." : "Confirm Redemption"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
