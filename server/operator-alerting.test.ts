import assert from "node:assert/strict";
import test from "node:test";
import {
  emitCustomerAiPersistenceAlert,
  setCustomerAiPersistenceAlertTransportForTests,
} from "./operator-alerting";

test("deployment operator alerting receives fixed load and save events", async () => {
  const delivered: unknown[] = [];
  setCustomerAiPersistenceAlertTransportForTests(async alert => {
    delivered.push(alert);
  });

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
  }
});