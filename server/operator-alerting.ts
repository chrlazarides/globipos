export type CustomerAiPersistenceOperation = "load" | "save";

export type CustomerAiPersistenceAlert = {
  event: "customer_ai_health_persistence_failed";
  operation: CustomerAiPersistenceOperation;
};

type CustomerAiPersistenceAlertTransport = (alert: CustomerAiPersistenceAlert) => Promise<void>;

const emailTransport: CustomerAiPersistenceAlertTransport = async alert => {
  const { sendCustomerAiPersistenceAlert } = await import("./email");
  await sendCustomerAiPersistenceAlert(alert.operation);
};

let customerAiPersistenceAlertTransport = emailTransport;

export function emitCustomerAiPersistenceAlert(operation: CustomerAiPersistenceOperation): void {
  const alert: CustomerAiPersistenceAlert = {
    event: "customer_ai_health_persistence_failed",
    operation,
  };
  void customerAiPersistenceAlertTransport(alert).catch(() => {
    console.error(`[operator-alert] customer_ai_health_persistence_failed ${operation} delivery failed`);
  });
}

export function setCustomerAiPersistenceAlertTransportForTests(
  transport?: CustomerAiPersistenceAlertTransport,
): void {
  customerAiPersistenceAlertTransport = transport ?? emailTransport;
}