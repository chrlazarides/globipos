import React, { useState, useEffect } from "react";
import { createRoot } from "react-dom/client";
import PaymentDialog from "../src/components/PaymentDialog";
import type { PaymentResult } from "../src/hooks/usePayment";
import { useOrder } from "../src/hooks/useOrder";
import type { Order } from "../src/types";

declare global {
  interface Window {
    cardMode: "approved" | "declined" | "delayed" | "error" | "missing-reference";
    cardCalls: number;
    cardAmounts: number[];
    savedPayments: PaymentResult[];
    rejectSave: boolean;
    nativeOrders: Order[];
    saveAttempts: Order[];
    orderNumbers: number;
    releaseCard?: () => void;
    __TAURI_INTERNALS__: { invoke: (command: string, args: any) => Promise<any> };
  }
}
window.cardMode = "approved";
window.cardCalls = 0;
window.cardAmounts = [];
window.savedPayments = [];
window.rejectSave = false;
window.nativeOrders = [];
window.saveAttempts = [];
window.orderNumbers = 0;
window.__TAURI_INTERNALS__ = {
  async invoke(command, args) {
    if (command === "next_order_number") return `TEST-${++window.orderNumbers}`;
    if (command === "write_audit") return;
    if (command === "save_order") {
      window.saveAttempts.push(args.order);
      if (window.rejectSave) throw new Error("TEST_SAVE_FAILED");
      window.nativeOrders.push(args.order);
      return;
    }
    if (command === "process_card_payment") {
      window.cardCalls++;
      window.cardAmounts.push(args.amount);
      if (window.cardMode === "delayed") await new Promise<void>(resolve => { window.releaseCard = resolve; });
      if (window.cardMode === "error") throw new Error("Gateway response timed out");
      if (window.cardMode === "declined") return { approved: false, provider: "jcc", error: "Card declined" };
      return { approved: true, provider: "jcc", reference: window.cardMode === "missing-reference" ? "" : `APPROVAL-${window.cardCalls}` };
    }
    if (command === "find_gift_voucher") return { id: "gift-1", code: "GIFT", remaining: 20, status: "open" };
    if (command === "find_credit_note") return { id: "credit-1", code: "NOTE", remaining: 20, status: "open" };
    throw new Error(`Unexpected native test command: ${command}`);
  },
};

function Fixture() {
  const [open, setOpen] = useState(true);
  const engine = useOrder("test-cashier", "Test cashier", "TEST");
  useEffect(() => {
    engine.addDepartmentLine({ id: "dept", server_id: "dept", name: "Test department", active: true, vat_rate: 0 }, 30);
  }, []);
  return <main className="min-h-screen bg-gray-100 p-8">
    <h1>Native split payment verification</h1>
    <PaymentDialog open={open} initialTab="split" orderTotal={engine.order.total} loyaltyPoints={1000}
      onCancel={() => setOpen(false)}
      onComplete={async result => {
        const method = result.tenders.length > 1 ? "split" : result.tenders[0].method;
        await engine.completeOrder(method, result.totalTendered, "test-cashier", "Test cashier",
          result.tenders.find(t => t.approved)?.reference, result.tenders);
        window.savedPayments.push(result);
        setOpen(false);
      }} />
  </main>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);