import assert from "node:assert/strict";
import test from "node:test";
import {
  deliverCustomerAiPersistenceAlert,
  retryCustomerAiPersistenceAlert,
  emitCustomerAiPersistenceAlert,
  setCustomerAiPersistenceAlertFailureRecorderForTests,
  setCustomerAiPersistenceAlertClaimerForTests,
  setCustomerAiPersistenceAlertResolverForTests,
  setCustomerAiPersistenceAlertRetryDelayForTests,
  setCustomerAiPersistenceAlertTransportForTests,
} from "./operator-alerting";

test("deployment operator alerting receives fixed load and save events", async () => {
  const delivered: unknown[] = [];
  setCustomerAiPersistenceAlertTransportForTests(async alert => {
    delivered.push(alert);
    return { success: true };
  });
  setCustomerAiPersistenceAlertResolverForTests(async () => {});

  try {
    emitCustomerAiPersistenceAlert("load");
    emitCustomerAiPersistenceAlert("save");
    await Promise.resolve();

    assert.deepEqual(delivered, [
      { event: "customer_ai_health_persistence_failed", operation: "load" },
      { event: "customer_ai_health_persistence_failed", operation: "save" },
    ]);
  } finally {
    setCustomerAiPersistenceAlertTransportForTests();
    setCustomerAiPersistenceAlertResolverForTests();
  }
});

test("missing support recipient is recorded durably without retrying", async () => {
  let transportCalls = 0;
  const recorded: unknown[] = [];
  setCustomerAiPersistenceAlertTransportForTests(async () => {
    transportCalls += 1;
    return {
      success: false,
      skipped: true,
      reason: "support_recipient_missing",
      error: "Support recipient is not configured",
    };
  });
  setCustomerAiPersistenceAlertFailureRecorderForTests(async (alert, delivery, attempts) => {
    recorded.push({ alert, delivery, attempts });
  });
  try {
    await deliverCustomerAiPersistenceAlert("load");
    assert.equal(transportCalls, 1);
    assert.deepEqual(recorded, [{
      alert: { event: "customer_ai_health_persistence_failed", operation: "load" },
      delivery: {
        success: false,
        skipped: true,
        reason: "support_recipient_missing",
        error: "Support recipient is not configured",
      },
      attempts: 1,
    }]);
  } finally {
    setCustomerAiPersistenceAlertTransportForTests();
    setCustomerAiPersistenceAlertFailureRecorderForTests();
  }
});

test("provider failures stop after three attempts and record one durable failure", async () => {
  let transportCalls = 0;
  const delays: number[] = [];
  const recorded: unknown[] = [];
  setCustomerAiPersistenceAlertTransportForTests(async () => {
    transportCalls += 1;
    return { success: false, reason: "email_delivery_failed", error: "provider unavailable" };
  });
  setCustomerAiPersistenceAlertRetryDelayForTests(async milliseconds => {
    delays.push(milliseconds);
  });
  setCustomerAiPersistenceAlertFailureRecorderForTests(async (alert, delivery, attempts) => {
    recorded.push({ alert, delivery, attempts });
  });
  try {
    await deliverCustomerAiPersistenceAlert("save");
    assert.equal(transportCalls, 3);
    assert.deepEqual(delays, [1_000, 5_000]);
    assert.deepEqual(recorded, [{
      alert: { event: "customer_ai_health_persistence_failed", operation: "save" },
      delivery: { success: false, reason: "email_delivery_failed", error: "provider unavailable" },
      attempts: 3,
    }]);
  } finally {
    setCustomerAiPersistenceAlertTransportForTests();
    setCustomerAiPersistenceAlertFailureRecorderForTests();
    setCustomerAiPersistenceAlertRetryDelayForTests();
  }
});

test("a delivery lease held by another worker suppresses duplicate sends", async () => {
  let transportCalls = 0;
  setCustomerAiPersistenceAlertTransportForTests(async () => {
    transportCalls += 1;
    return { success: true };
  });
  setCustomerAiPersistenceAlertClaimerForTests(async () => null);
  try {
    await deliverCustomerAiPersistenceAlert("save");
    assert.equal(transportCalls, 0);
  } finally {
    setCustomerAiPersistenceAlertTransportForTests();
    setCustomerAiPersistenceAlertClaimerForTests();
  }
});

test("manual retry claims only an existing due warning and uses the normal attempt cap", async () => {
  const claimModes: boolean[] = [];
  let transportCalls = 0;
  setCustomerAiPersistenceAlertTransportForTests(async () => {
    transportCalls += 1;
    return { success: false, reason: "email_delivery_failed", error: "provider unavailable" };
  });
  setCustomerAiPersistenceAlertClaimerForTests(async (_alert, existingOnly) => {
    claimModes.push(Boolean(existingOnly));
    return "manual-retry-claim";
  });
  setCustomerAiPersistenceAlertRetryDelayForTests(async () => {});
  setCustomerAiPersistenceAlertFailureRecorderForTests(async () => {});
  try {
    assert.equal(await retryCustomerAiPersistenceAlert("load"), "failed");
    assert.deepEqual(claimModes, [true]);
    assert.equal(transportCalls, 3);
  } finally {
    setCustomerAiPersistenceAlertTransportForTests();
    setCustomerAiPersistenceAlertClaimerForTests();
    setCustomerAiPersistenceAlertRetryDelayForTests();
    setCustomerAiPersistenceAlertFailureRecorderForTests();
  }
});

test("manual retry does not send when lease or cooldown prevents a claim", async () => {
  let transportCalls = 0;
  setCustomerAiPersistenceAlertTransportForTests(async () => {
    transportCalls += 1;
    return { success: true };
  });
  setCustomerAiPersistenceAlertClaimerForTests(async () => null);
  try {
    assert.equal(await retryCustomerAiPersistenceAlert("save"), "not_claimed");
    assert.equal(transportCalls, 0);
  } finally {
    setCustomerAiPersistenceAlertTransportForTests();
    setCustomerAiPersistenceAlertClaimerForTests();
  }
});