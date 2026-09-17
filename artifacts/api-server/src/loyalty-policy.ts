export interface LoyaltyPolicyValues {
  loyaltyEnabled: boolean;
  cashbackEnabled: boolean;
  pointsPerEuro: number;
  redeemPointsPerEuro: number;
  minimumRedemptionPoints: number;
  silverThreshold: number;
  goldThreshold: number;
  bronzeCashbackPercent: number;
  silverCashbackPercent: number;
  goldCashbackPercent: number;
  maxCashbackOrderPercent: number;
}

const money = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

export function calculateCashbackReservation(
  availableCashback: number,
  grossTotal: number,
  useCashback: boolean,
  policy: Pick<LoyaltyPolicyValues, "cashbackEnabled" | "maxCashbackOrderPercent">,
) {
  if (!useCashback || !policy.cashbackEnabled) return 0;
  const limit = grossTotal * (policy.maxCashbackOrderPercent / 100);
  return money(Math.max(0, Math.min(availableCashback, grossTotal, limit)));
}

export function calculateCompletedRewards(
  subtotal: number,
  priorPointsBalance: number,
  policy: LoyaltyPolicyValues,
) {
  const points = policy.loyaltyEnabled
    ? Math.max(0, Math.floor(subtotal * policy.pointsPerEuro))
    : 0;
  const tierBalance = priorPointsBalance + points;
  const cashbackPercent = tierBalance >= policy.goldThreshold
    ? policy.goldCashbackPercent
    : tierBalance >= policy.silverThreshold
      ? policy.silverCashbackPercent
      : policy.bronzeCashbackPercent;
  const cashback = policy.cashbackEnabled
    ? money(Math.max(0, subtotal * cashbackPercent / 100))
    : 0;
  return { points, cashback, cashbackPercent };
}

export function assertPortalOrderTransition(current: string, next: string) {
  const valid: Record<string, string[]> = {
    pending: ["confirmed", "rejected", "cancelled"],
    confirmed: ["completed", "rejected", "cancelled"],
    completed: ["refunded"],
  };
  if (current === next) return;
  if (!valid[current]?.includes(next)) throw new Error("INVALID_ORDER_TRANSITION");
}

export function validateRedemption(points: number, availablePoints: number, policy: LoyaltyPolicyValues) {
  if (!Number.isInteger(points) || points <= 0) throw new Error("INVALID_REDEMPTION");
  if (points < policy.minimumRedemptionPoints) throw new Error("REDEMPTION_BELOW_MINIMUM");
  if (points % policy.redeemPointsPerEuro !== 0) throw new Error("INVALID_REDEMPTION_MULTIPLE");
  if (points > availablePoints) throw new Error("INSUFFICIENT_POINTS");
  return money(points / policy.redeemPointsPerEuro);
}

export function calculateRefundCashbackBalance(
  currentBalance: number,
  earnedCashback: number,
  appliedCashback: number,
) {
  return money(currentBalance - earnedCashback + appliedCashback);
}