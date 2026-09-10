export type ApprovedCardReferenceResolution =
  | { kind: "complete"; reference: string; canRetry: false }
  | { kind: "verification_required"; message: string; canRetry: false };

export function resolveApprovedCardReference(reference: unknown): ApprovedCardReferenceResolution {
  if (typeof reference !== "string" || !reference.trim()) {
    return {
      kind: "verification_required",
      message: "Approved card payment has no terminal reference. Verify the payment before completing the order.",
      canRetry: false,
    };
  }
  return { kind: "complete", reference: reference.trim(), canRetry: false };
}

export function canStartSelfCheckoutPayment(mode: string): boolean {
  return mode === "scanning";
}

export function canGenericAttendantRelease(mode: string): boolean {
  return mode !== "payment_verification";
}

export type CardPaymentOutcome =
  | { kind: "complete"; reference: string; canRetry: false }
  | { kind: "declined"; message: string; canRetry: true }
  | { kind: "verification_required"; message: string; canRetry: false };

export function resolveCardPaymentOutcome(result: unknown): CardPaymentOutcome {
  if (!result || typeof result !== "object" || !("approved" in result)) {
    return { kind: "verification_required", message: "The terminal result could not be verified.", canRetry: false };
  }

  const paymentResult = result as { approved: unknown; reference?: unknown; error?: unknown };
  if (paymentResult.approved === true) {
    return resolveApprovedCardReference(paymentResult.reference);
  }

  const message = typeof paymentResult.error === "string" && paymentResult.error.trim()
    ? paymentResult.error.trim()
    : "The terminal did not provide a definitive payment result.";
  if (/\b(declin(?:e|ed)|refus(?:e|ed)|cancel(?:led|ed)?)\b/i.test(message)) {
    return { kind: "declined", message, canRetry: true };
  }
  return { kind: "verification_required", message, canRetry: false };
}