import crypto from "crypto";
import { and, eq, isNull, lt, lte, or, sql } from "drizzle-orm";
import { operatorAlertFailures } from "@shared/schema";

export type CustomerAiPersistenceOperation = "load" | "save";

export type CustomerAiPersistenceAlert = {
  event: "customer_ai_health_persistence_failed";
  operation: CustomerAiPersistenceOperation;
};

export type CustomerAiPersistenceAlertDelivery = {
  success: boolean;
  skipped?: boolean;
  reason?: "support_recipient_missing" | "email_delivery_failed";
  error?: string;
};

type CustomerAiPersistenceAlertTransport = (
  alert: CustomerAiPersistenceAlert,
) => Promise<CustomerAiPersistenceAlertDelivery | void>;

type CustomerAiPersistenceAlertFailureRecorder = (
  alert: CustomerAiPersistenceAlert,
  delivery: CustomerAiPersistenceAlertDelivery,
  attempts: number,
  claimToken: string,
) => Promise<void>;
type CustomerAiPersistenceAlertResolver = (
  alert: CustomerAiPersistenceAlert,
  claimToken: string,
) => Promise<void>;
type CustomerAiPersistenceAlertClaimer = (
  alert: CustomerAiPersistenceAlert,
) => Promise<string | null>;

const emailTransport: CustomerAiPersistenceAlertTransport = async alert => {
  const { sendCustomerAiPersistenceAlert } = await import("./email");
  return sendCustomerAiPersistenceAlert(alert.operation);
};

let customerAiPersistenceAlertTransport = emailTransport;
let retryDelay = (milliseconds: number) => new Promise<void>(resolve => setTimeout(resolve, milliseconds));
const RETRY_DELAYS_MS = [1_000, 5_000] as const;
const DELIVERY_TIMEOUT_MS = 10_000;
const DELIVERY_LEASE_MS = 2 * 60_000;
const FAILED_DELIVERY_COOLDOWN_MS = 15 * 60_000;

function alertKey(alert: CustomerAiPersistenceAlert) {
  return `${alert.event}:${alert.operation}`;
}

function withDeliveryDeadline(
  promise: Promise<CustomerAiPersistenceAlertDelivery | void>,
): Promise<CustomerAiPersistenceAlertDelivery | void> {
  return new Promise(resolve => {
    const timer = setTimeout(() => resolve({
      success: false,
      reason: "email_delivery_failed",
      error: `Operator alert delivery timed out after ${DELIVERY_TIMEOUT_MS / 1000} seconds`,
    }), DELIVERY_TIMEOUT_MS);
    promise.then(
      result => {
        clearTimeout(timer);
        resolve(result);
      },
      error => {
        clearTimeout(timer);
        resolve({
          success: false,
          reason: "email_delivery_failed",
          error: error instanceof Error ? error.message : "Operator alert transport failed",
        });
      },
    );
  });
}

let deliveryDeadline = withDeliveryDeadline;

const databaseAlertClaimer: CustomerAiPersistenceAlertClaimer = async alert => {
  const { db } = await import("./db");
  const now = new Date();
  const token = crypto.randomUUID();
  await db.insert(operatorAlertFailures).values({
    alertKey: alertKey(alert),
    event: alert.event,
    operation: alert.operation,
    reason: "Operator alert delivery is pending",
    deliveryAttempts: 0,
    status: "pending",
    firstFailedAt: now,
    lastFailedAt: now,
    resolvedAt: null,
  }).onConflictDoUpdate({
    target: operatorAlertFailures.alertKey,
    set: {
      occurrenceCount: sql`${operatorAlertFailures.occurrenceCount} + 1`,
      lastFailedAt: now,
      resolvedAt: null,
    },
  });
  const staleClaim = new Date(now.getTime() - DELIVERY_LEASE_MS);
  const [claimed] = await db.update(operatorAlertFailures).set({
    status: "delivering",
    reason: "Operator alert delivery is in progress",
    claimedAt: now,
    claimToken: token,
  }).where(and(
    eq(operatorAlertFailures.alertKey, alertKey(alert)),
    or(isNull(operatorAlertFailures.claimedAt), lt(operatorAlertFailures.claimedAt, staleClaim)),
    or(isNull(operatorAlertFailures.nextAttemptAt), lte(operatorAlertFailures.nextAttemptAt, now)),
  )).returning({ alertKey: operatorAlertFailures.alertKey });
  return claimed ? token : null;
};

let customerAiPersistenceAlertClaimer = databaseAlertClaimer;
let bypassAlertClaimForTests = false;

const databaseFailureRecorder: CustomerAiPersistenceAlertFailureRecorder = async (alert, delivery, attempts, claimToken) => {
  const { db } = await import("./db");
  const now = new Date();
  const alertKey = `${alert.event}:${alert.operation}`;
  await db.update(operatorAlertFailures).set({
    reason: delivery.error ?? delivery.reason ?? "Operator alert delivery failed",
    deliveryAttempts: attempts,
    status: "failed",
    lastFailedAt: now,
    nextAttemptAt: new Date(now.getTime() + FAILED_DELIVERY_COOLDOWN_MS),
    claimedAt: null,
    claimToken: null,
  }).where(and(
    eq(operatorAlertFailures.alertKey, alertKey),
    eq(operatorAlertFailures.claimToken, claimToken),
  ));
};

let customerAiPersistenceAlertFailureRecorder = databaseFailureRecorder;

const databaseAlertResolver: CustomerAiPersistenceAlertResolver = async (alert, claimToken) => {
  const { db } = await import("./db");
  await db.update(operatorAlertFailures)
    .set({
      status: "resolved",
      reason: "Operator alert delivered successfully",
      resolvedAt: new Date(),
      claimedAt: null,
      claimToken: null,
      nextAttemptAt: null,
    })
    .where(and(
      eq(operatorAlertFailures.alertKey, alertKey(alert)),
      eq(operatorAlertFailures.claimToken, claimToken),
    ));
};

let customerAiPersistenceAlertResolver = databaseAlertResolver;

export async function deliverCustomerAiPersistenceAlert(
  operation: CustomerAiPersistenceOperation,
): Promise<void> {
  const transport = customerAiPersistenceAlertTransport;
  const claimer = customerAiPersistenceAlertClaimer;
  const recorder = customerAiPersistenceAlertFailureRecorder;
  const resolver = customerAiPersistenceAlertResolver;
  const deadline = deliveryDeadline;
  const delay = retryDelay;
  const bypassClaim = bypassAlertClaimForTests;
  const alert: CustomerAiPersistenceAlert = {
    event: "customer_ai_health_persistence_failed",
    operation,
  };
  const claimToken = bypassClaim ? "test-claim" : await claimer(alert);
  if (!claimToken) return;
  let delivery: CustomerAiPersistenceAlertDelivery = { success: false };
  let attempts = 0;
  for (let index = 0; index <= RETRY_DELAYS_MS.length; index += 1) {
    attempts += 1;
    try {
      const result = await deadline(transport(alert));
      if (!result) return;
      delivery = result;
    } catch (error) {
      delivery = {
        success: false,
        reason: "email_delivery_failed",
        error: error instanceof Error ? error.message : "Operator alert transport failed",
      };
    }
    if (delivery.success) {
      await resolver(alert, claimToken).catch(error => {
        console.error("[operator-alert] Failed to resolve durable delivery warning:", error);
      });
      return;
    }
    if (delivery.skipped || index === RETRY_DELAYS_MS.length) break;
    await delay(RETRY_DELAYS_MS[index]);
  }
  await recorder(alert, delivery, attempts, claimToken);
  console.error(`[operator-alert] customer_ai_health_persistence_failed ${operation} delivery failed after ${attempts} attempt${attempts === 1 ? "" : "s"}`);
}

export function emitCustomerAiPersistenceAlert(operation: CustomerAiPersistenceOperation): void {
  void deliverCustomerAiPersistenceAlert(operation)
    .catch(error => console.error("[operator-alert] Failed to record operator alert delivery failure:", error));
}

export function setCustomerAiPersistenceAlertTransportForTests(
  transport?: CustomerAiPersistenceAlertTransport,
): void {
  customerAiPersistenceAlertTransport = transport ?? emailTransport;
  bypassAlertClaimForTests = Boolean(transport);
  customerAiPersistenceAlertClaimer = databaseAlertClaimer;
  customerAiPersistenceAlertFailureRecorder = transport ? async () => {} : databaseFailureRecorder;
  customerAiPersistenceAlertResolver = transport ? async () => {} : databaseAlertResolver;
}

export function setCustomerAiPersistenceAlertFailureRecorderForTests(
  recorder?: CustomerAiPersistenceAlertFailureRecorder,
): void {
  customerAiPersistenceAlertFailureRecorder = recorder ?? databaseFailureRecorder;
}

export function setCustomerAiPersistenceAlertRetryDelayForTests(
  delay?: (milliseconds: number) => Promise<void>,
): void {
  retryDelay = delay ?? (milliseconds => new Promise<void>(resolve => setTimeout(resolve, milliseconds)));
}

export function setCustomerAiPersistenceAlertResolverForTests(
  resolver?: CustomerAiPersistenceAlertResolver,
): void {
  customerAiPersistenceAlertResolver = resolver ?? databaseAlertResolver;
}

export function setCustomerAiPersistenceAlertClaimerForTests(
  claimer?: CustomerAiPersistenceAlertClaimer,
): void {
  bypassAlertClaimForTests = false;
  customerAiPersistenceAlertClaimer = claimer ?? databaseAlertClaimer;
}

export function setCustomerAiPersistenceAlertDeadlineForTests(
  deadline?: typeof withDeliveryDeadline,
): void {
  deliveryDeadline = deadline ?? withDeliveryDeadline;
}