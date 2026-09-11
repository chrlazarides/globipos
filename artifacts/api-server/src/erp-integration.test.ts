import test from "node:test";
import assert from "node:assert/strict";
import { calculateInboundInvoice, canonicalSyncHash, createErpAdapter, decodeSoftOneBrowser, driveStockReconciliation, erpPaymentJournalLines, expandSapPayment, expandSapRecords, expandSoftOnePayment, hasSucceededAttempt, inboundInvoiceMarker, inboundInvoiceNumber, inboundPaymentMarker, isInboundInvoiceEligible, isOutboundInvoiceEligible, parseSoftOneBalance, paymentSetAtomicSequence, sapPullSpec, sapUdfEntities, softOneData, softOneNumericId, softOnePrimaryId, stalePaymentExternalIds, stockOperationIdentity, toSapPayload, toSoftOnePayload, validateSapUdf, withSapCorrelation } from "./erp-integration";
import { erpProviderBinding } from "@shared/erp-provider-binding";

test("SAP item mapping uses the business SKU rather than an internal ID", () => {
  const payload = toSapPayload("items", { id: "internal-id", sku: "SKU-42", name: "Coffee", price1: "4.50", active: true });
  assert.equal(payload.ItemCode, "SKU-42");
  assert.equal(payload.ItemName, "Coffee");
  assert.equal(payload.ItemPrices[0].Price, 4.5);
});

test("a success among previous attempts prevents a duplicate provider write", () => {
  assert.equal(hasSucceededAttempt([{ status: "failed" }, { status: "succeeded" }]), true);
  assert.equal(hasSucceededAttempt([{ status: "failed" }]), false);
});

test("SAP invoices deterministically map lines to Service Layer fields", () => {
  const payload = toSapPayload("invoices", { customerCode: "C-1", invoiceNumber: "INV-2", date: "2026-01-01" }, [{ sku: "SKU-1", description: "Item", quantity: "2", unitPrice: "3.25", discountPercent: "5" }]);
  assert.equal(payload.CardCode, "C-1");
  assert.deepEqual(payload.DocumentLines, [{ ItemCode: "SKU-1", ItemDescription: "Item", Quantity: 2, UnitPrice: 3.25, DiscountPercent: 5 }]);
});

test("SAP invoice NumAtCard survives outbound payload and inbound projection", () => {
  const payload = toSapPayload("invoices", { customerCode: "C", invoiceNumber: "ORIGINAL-42", date: "2026-01-01" }, []);
  const pulled = expandSapRecords("invoices", [{ ...payload, DocEntry: 8, DocNum: 900 }]);
  assert.equal(inboundInvoiceNumber(pulled[0].data, pulled[0].id), "ORIGINAL-42");
  assert.match(sapPullSpec("invoices").select, /NumAtCard/);
});

test("actual SoftOne adapter performs auth, browser pull hydration, and correlated push", async () => {
  const services: string[] = [];
  const request = async (_url: string, init: RequestInit) => {
    const payload = JSON.parse(String(init.body));
    services.push(payload.service);
    const bodies: Record<string, any> = {
      login: { success: true, clientID: "login-client", objs: [{ COMPANY: "1", BRANCH: "1", MODULE: "1", REFID: "1" }] },
      authenticate: { success: true, clientID: "auth-client" },
      getBrowserInfo: { success: true, reqID: "req", columns: [{ name: "TRDR" }, { name: "CODE" }] },
      getBrowserData: { success: true, totalcount: 1, rows: [[12, "C12"]] },
      getData: { success: true, data: { CUSTOMER: [{ TRDR: 12, CODE: "C12", NAME: "Customer" }] } },
      setData: { success: true, id: 12 },
    };
    return new Response(JSON.stringify(bodies[payload.service]), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  const use = createErpAdapter("softone", { endpoint: "https://soft.test", username: "u", password: "p", company: "1", appId: "app" }, request);
  await use.test();
  const page = await use.pull("customers");
  assert.equal(page.records[0].data.NAME, "Customer");
  assert.equal(await use.push("customers", toSoftOnePayload("customers", { externalKey: "k", code: "C12", name: "Customer" }), "k", "12"), "12");
  assert.deepEqual(services.slice(0, 2), ["login", "authenticate"]);
  assert.ok(services.includes("getBrowserData") && services.includes("getData") && services.includes("setData"));
});

test("actual SAP adapter validates UDFs, follows pagination, and sends correlation on push", async () => {
  const requests: Array<{ url: string; init: RequestInit }> = [];
  const request = async (url: string, init: RequestInit) => {
    requests.push({ url, init });
    if (url.endsWith("/Login")) return new Response("{}", { status: 200, headers: { "set-cookie": "B1SESSION=session" } });
    if (url.includes("$select=U_GlobiPOSKey")) return new Response(JSON.stringify({ value: [] }), { status: 200 });
    if (url.includes("Invoices?") && !url.includes("page=2")) return new Response(JSON.stringify({ value: [{ DocEntry: 1, NumAtCard: "I-1", Cancelled: "tYES", DocumentStatus: "bost_Close", DocumentLines: [] }], "@odata.nextLink": "Invoices?page=2" }), { status: 200 });
    if (url.includes("Invoices?page=2")) return new Response(JSON.stringify({ value: [{ DocEntry: 2, NumAtCard: "I-2", DocumentLines: [] }] }), { status: 200 });
    if (url.includes("BusinessPartners?")) return new Response(JSON.stringify({ value: [] }), { status: 200 });
    return new Response(JSON.stringify({ CardCode: "C1" }), { status: 200 });
  };
  const use = createErpAdapter("sap-b1", { endpoint: "https://sap.test", username: "u", password: "p", company: "db" }, request);
  await use.test();
  const invoiceRecords = (await use.pull("invoices")).records;
  assert.equal(invoiceRecords.length, 2);
  assert.equal(isInboundInvoiceEligible(invoiceRecords[0].data), false);
  await use.push("customers", { CardCode: "C1", CardName: "Customer" }, "correlation");
  const pushed = requests.find(entry => entry.init.method === "POST" && entry.url.includes("BusinessPartners"));
  assert.equal(JSON.parse(String(pushed!.init.body)).U_GlobiPOSKey, "correlation");
});

test("actual SoftOne invoice hydration exposes cancellation state for lifecycle filtering", async () => {
  const request = async (_url: string, init: RequestInit) => {
    const { service } = JSON.parse(String(init.body));
    const body = service === "login" ? { success: true, clientID: "c", objs: [{ COMPANY: "1", BRANCH: "1", MODULE: "1", REFID: "1" }] }
      : service === "authenticate" ? { success: true, clientID: "a" }
      : service === "getBrowserInfo" ? { success: true, reqID: "r", columns: [{ name: "FINDOC" }] }
      : service === "getBrowserData" ? { success: true, totalcount: 1, rows: [[77]] }
      : { success: true, data: { SALDOC: [{ FINDOC: 77, FINCODE: "S-77", CANCELLED: 1, STATUS: "cancelled" }], ITELINES: [] } };
    return new Response(JSON.stringify(body), { status: 200 });
  };
  const use = createErpAdapter("softone", { endpoint: "https://soft.test", username: "u", password: "p", company: "1", appId: "app" }, request);
  const [record] = (await use.pull("invoices")).records;
  assert.equal(record.id, "77");
  assert.equal(isInboundInvoiceEligible(record.data), false);
});

test("provider binding never enables actions or status for a mismatched dialog", () => {
  const config = { provider: "sap-b1", enabled: true, lastSyncStatus: "succeeded" };
  const mismatch = erpProviderBinding(config, "softone");
  assert.equal(mismatch.matchingConfig, null);
  assert.equal(mismatch.canTest, false);
  assert.equal(mismatch.canRun, false);
  assert.match(mismatch.mismatchLabel!, /SAP Business One/);
  const match = erpProviderBinding(config, "sap-b1");
  assert.equal(match.canTest, true);
  assert.equal(match.canRun, true);
  assert.equal(match.matchingConfig?.lastSyncStatus, "succeeded");
});

test("provider-neutral inbound invoice lifecycle excludes cancelled, voided and draft documents", () => {
  assert.equal(isInboundInvoiceEligible({ Cancelled: "tYES", DocumentStatus: "bost_Close" }), false);
  assert.equal(isInboundInvoiceEligible({ CANCEL: 1 }), false);
  assert.equal(isInboundInvoiceEligible({ ISCANCEL: "Y" }), false);
  assert.equal(isInboundInvoiceEligible({ status: "voided" }), false);
  assert.equal(isInboundInvoiceEligible({ STATUS: "draft" }), false);
  assert.equal(isInboundInvoiceEligible({ Cancelled: "tNO", DocumentStatus: "bost_Open" }), true);
  assert.match(sapPullSpec("invoices").select, /Cancelled/);
  assert.match(sapPullSpec("invoices").select, /DocumentStatus/);
});

test("outbound eligibility only permits finalized sales invoices", () => {
  for (const status of ["posted", "sent", "paid", "partial", "overdue"]) assert.equal(isOutboundInvoiceEligible({ type: "invoice", status }), true);
  for (const status of ["draft", "cancelled"]) assert.equal(isOutboundInvoiceEligible({ type: "invoice", status }), false);
  for (const type of ["proforma", "quotation", "credit_note"]) assert.equal(isOutboundInvoiceEligible({ type, status: "posted" }), false);
});

test("SoftOne payload retains an explicit external correlation key", () => {
  const payload = toSoftOnePayload("customers", { externalKey: "local-customer", name: "Customer" });
  assert.equal(payload.externalKey, "local-customer");
  assert.equal(payload.data.CUSTOMER[0].NAME, "Customer");
});

test("SoftOne hydrated uppercase datasets are mapped with invoice lines", () => {
  assert.deepEqual(softOneData({ data: { FINDOC: [{ FINDOC: 9, TRDR: "C1" }], ITELINES: [{ MTRL: "I1" }] } }, "invoices"), {
    FINDOC: 9, TRDR: "C1", ITELINES: [{ MTRL: "I1" }],
  });
});

test("SAP pull specifications use entity-specific fields and expansions", () => {
  assert.equal(sapPullSpec("customers").entity, "BusinessPartners");
  assert.match(sapPullSpec("items").select, /ItemPrices/);
  assert.match(sapPullSpec("stock").select, /ItemWarehouseInfoCollection/);
  assert.match(sapPullSpec("invoices").select, /DiscountPercent/);
  assert.match(sapPullSpec("invoices").select, /RoundingDiffAmount/);
  assert.equal(sapPullSpec("payments").expand, "PaymentInvoices");
});

test("SAP UDF contract validation covers every outbound idempotency entity", () => {
  assert.deepEqual(sapUdfEntities(), ["BusinessPartners", "Items", "InventoryGenEntries", "InventoryGenExits", "Invoices", "IncomingPayments"]);
});

test("SAP Service Layer UDF contract is checked and outbound payload is correlated", async () => {
  const requested: string[] = [];
  await validateSapUdf(async entity => { requested.push(entity); return { value: [] }; });
  assert.deepEqual(requested, sapUdfEntities());
  await assert.rejects(validateSapUdf(async entity => { if (entity === "Items") throw new Error("invalid property"); }), /SAP_UDF_GLOBIPOSKEY_REQUIRED/);
  assert.deepEqual(withSapCorrelation({ ItemCode: "SKU" }, "operation-key"), { ItemCode: "SKU", U_GlobiPOSKey: "operation-key" });
});

test("SAP payments use allocation invoice keys, not payment DocEntry", () => {
  const records = expandSapRecords("payments", [{
    DocEntry: 99, CardCode: "C1", UpdateDate: "2026-01-01",
    PaymentInvoices: [{ DocEntry: 12, SumApplied: 8 }, { DocEntry: 13, SumApplied: 2 }],
  }]);
  assert.deepEqual(records.map(record => [record.id, record.data.PaymentDocEntry, record.data.InvoiceDocEntry, record.data.AllocatedAmount]), [
    ["99:allocation:0:cash", 99, 12, 8], ["99:allocation:1:cash", 99, 13, 2],
  ]);
});

test("canonical hashes include nested invoice line edits", () => {
  const header = { id: "invoice", total: "10" };
  assert.notEqual(canonicalSyncHash({ header, lines: [{ quantity: 1 }] }), canonicalSyncHash({ header, lines: [{ quantity: 2 }] }));
});

test("SoftOne browser metadata arrays decode fields and primary business IDs", () => {
  const info = { data: [{ REQID: "request-1", TOTALCOUNT: 1 }], columns: [{ name: "MTRL" }, { name: "CODE" }] };
  const decoded = decodeSoftOneBrowser(info, { rows: [[42, "SKU-42"]] });
  assert.equal(decoded.reqID, "request-1");
  assert.deepEqual(decoded.rows[0], { MTRL: 42, CODE: "SKU-42" });
  assert.equal(softOnePrimaryId("items", decoded.rows[0]), "42");
});

test("SoftOne transactional payloads use named datasets and numeric dependencies", () => {
  const invoice = toSoftOnePayload("invoices", { externalKey: "k", customerExternalId: "7", date: "2026-01-01", invoiceNumber: "I-1" }, [{ externalItemId: "9", quantity: 2, unitPrice: 3 }]);
  assert.equal(invoice.data.SALDOC[0].TRDR, 7);
  assert.equal(invoice.data.ITELINES[0].MTRL, 9);
  const stock = toSoftOnePayload("stock", { externalKey: "cycle", materialId: "9", date: "2026-01-01", stockDelta: -2 });
  assert.equal(stock.object, "MTRDOC");
  assert.equal(stock.data.MTRLINES[0].QTY1, -2);
  assert.throws(() => softOneNumericId("SKU-9"), /SOFTONE_DEPENDENCY_ID/);
});

test("SAP tender mapping and on-account remainder are preserved", () => {
  assert.equal(toSapPayload("payments", { customerCode: "C", amount: "4", paymentDate: "2026-01-01", paymentMethod: "transfer" }).TransferSum, 4);
  const records = expandSapRecords("payments", [{ DocEntry: 4, CardCode: "C", TransferSum: 10, PaymentInvoices: [{ DocEntry: 2, SumApplied: 6 }] }]);
  assert.equal(records[0].data.paymentMethod, "bank_transfer");
  assert.equal(records[1].id, "4:on-account:bank_transfer");
  assert.equal(records[1].data.AllocatedAmount, 4);
  assert.equal(records[1].data.InvoiceDocEntry, undefined);
});

test("SoftOne stock keeps MTRBAL identity/balance separate from MTRDOC identity", () => {
  const stock = softOneData({ data: { ITEM: [{ MTRL: 5, QTY1: 99 }], MTRBAL: [{ MTRL: 5, WHOUSE: "1", QTY1: 22 }, { MTRL: 5, WHOUSE: "2", QTY1: 7 }] } }, "stock", "2");
  assert.equal(stock.QTY1, 7);
  assert.equal(softOnePrimaryId("stock", stock), "5");
  assert.equal(softOnePrimaryId("stock", { FINDOC: 88, MTRL: 5 }, "MTRDOC"), "88");
  assert.equal(parseSoftOneBalance(stock), 7);
  assert.throws(() => parseSoftOneBalance({ MTRL: 5 }), /SOFTONE_BALANCE_UNAVAILABLE/);
  assert.throws(() => softOneData({ data: { MTRBAL: [{ MTRL: 5, WHOUSE: "1", QTY1: 22 }] } }, "stock", "2"), /SOFTONE_WAREHOUSE_BALANCE_MISSING/);
});

test("SAP stock selects only the configured warehouse and rejects a missing one", () => {
  const rows = [{ ItemCode: "SKU", ItemWarehouseInfoCollection: [{ WarehouseCode: "A", InStock: 4 }, { WarehouseCode: "B", InStock: 11 }] }];
  assert.equal(expandSapRecords("stock", rows, "B")[0].data.Quantity, 11);
  assert.throws(() => expandSapRecords("stock", rows, "C"), /SAP_WAREHOUSE_BALANCE_MISSING/);
  assert.throws(() => expandSapRecords("stock", rows), /SAP_WAREHOUSE_REQUIRED/);
});

test("SAP mixed tenders project separate allocation and on-account records", () => {
  const records = expandSapPayment({ DocEntry: 7, CashSum: 5, CreditSum: 8, PaymentInvoices: [{ DocEntry: 20, SumApplied: 9 }] });
  assert.deepEqual(records.map(record => [record.data.paymentMethod, record.data.InvoiceDocEntry, record.data.AllocatedAmount]), [
    ["cash", 20, 5], ["card", 20, 4], ["card", undefined, 4],
  ]);
  assert.deepEqual(stalePaymentExternalIds("7", ["7:allocation:0:cash", "7:allocation:1:card", "8:on-account:cash"], records.map(record => record.id)), ["7:allocation:1:card"]);
});

test("SoftOne PAYDOC settlement lines carry and import mapped invoice IDs", () => {
  const payload = toSoftOnePayload("payments", { externalKey: "p", customerExternalId: "3", invoiceExternalId: "44", paymentDate: "2026-01-01", amount: 12 });
  assert.deepEqual(payload.data.PAYLINES, [{ APPLFINDOC: 44, SUMAMNT: 12 }]);
  const records = expandSoftOnePayment({ FINDOC: 9, SUMAMNT: 12, PAYLINES: [{ APPLFINDOC: 44, SUMAMNT: 12 }] });
  assert.equal(records[0].data.InvoiceDocEntry, 44);
  assert.equal(records[0].data.PaymentDocEntry, "9");
});

test("invoice recovery marker is generation/external specific", () => {
  assert.notEqual(inboundInvoiceMarker("c", 1, "10"), inboundInvoiceMarker("c", 2, "10"));
  assert.notEqual(inboundInvoiceMarker("c", 1, "10"), inboundInvoiceMarker("c", 1, "11"));
});

test("payment recovery marker is stable across crash retries", () => {
  assert.equal(inboundPaymentMarker("config", 2, "99:0"), inboundPaymentMarker("config", 2, "99:0"));
  assert.notEqual(inboundPaymentMarker("config", 2, "99:0"), inboundPaymentMarker("config", 2, "99:1"));
});

test("payment replacement sequence validates first and commits audit last atomically", () => {
  assert.deepEqual(paymentSetAtomicSequence(), [
    "validate_dependencies", "begin_transaction", "delete_stale", "upsert_current",
    "update_mappings", "recalculate_invoices", "write_audits", "commit",
  ]);
});

test("ERP payment journal lines are balanced and use the normal tender and receivable accounts", () => {
  for (const [method, tender] of [["cash", "1000"], ["card", "1010"], ["cheque", "1010"], ["bank", "1010"]]) {
    const lines = erpPaymentJournalLines(method, 25.5);
    assert.equal(lines[0].accountCode, tender);
    assert.equal(lines[0].debit, 25.5);
    assert.deepEqual(lines[1], { accountCode: "1100", debit: 0, credit: 25.5, description: "Accounts Receivable" });
    assert.equal(lines.reduce((sum, line) => sum + line.debit - line.credit, 0), 0);
  }
});

test("stock reconciliation retries reuse identity while new cycles and revisions differ", () => {
  const first = stockOperationIdentity("c", 1, "item", 4, 10, 7, "r1");
  assert.equal(first, stockOperationIdentity("c", 1, "item", 4, 10, 7, "r1"));
  assert.notEqual(first, stockOperationIdentity("c", 1, "item", 5, 10, 7, "r1"));
  assert.notEqual(first, stockOperationIdentity("c", 1, "item", 4, 10, 7, "r2"));
});

test("stock reconciliation supersedes an uncertain stale observation and converges before success", async () => {
  type Cycle = { correlationKey: string; targetQuantity: number; observedQuantity: number; observedRevision: string };
  let provider = { quantity: 8, revision: "independent-change" };
  const pending: Cycle = { correlationKey: "old", targetQuantity: 10, observedQuantity: 5, observedRevision: "old-revision" };
  const retired: Array<[string, string]> = [];
  const pushed: string[] = [];
  let cycleNumber = 1;
  const result = await driveStockReconciliation<Cycle>({
    target: 10, observation: { quantity: 5, revision: "old-revision" }, pending,
    recover: async () => undefined,
    read: async () => ({ ...provider }),
    create: async observation => ({ correlationKey: `new-${cycleNumber++}`, targetQuantity: 10, observedQuantity: observation.quantity, observedRevision: observation.revision }),
    push: async cycle => { pushed.push(cycle.correlationKey); provider = { quantity: provider.quantity + cycle.targetQuantity - cycle.observedQuantity, revision: `after-${cycle.correlationKey}` }; return `movement-${cycle.correlationKey}`; },
    retire: async (cycle, status) => { retired.push([cycle.correlationKey, status]); },
  });
  assert.equal(result.status, "succeeded");
  assert.equal(result.observation.quantity, 10);
  assert.deepEqual(pushed, ["new-1"]);
  assert.deepEqual(retired, [["old", "superseded"], ["new-1", "succeeded"]]);
});

test("stock reconciliation accepts a recovered applied movement only after exact balance verification", async () => {
  const pending = { correlationKey: "old", targetQuantity: 10, observedQuantity: 5, observedRevision: "r1" };
  const retired: string[] = [];
  let pushes = 0;
  const result = await driveStockReconciliation({
    target: 10, observation: { quantity: 5, revision: "r1" }, pending,
    recover: async () => "movement-1",
    read: async () => ({ quantity: 10, revision: "r2" }),
    create: async () => { throw new Error("must not create"); },
    push: async () => { pushes++; return "unexpected"; },
    retire: async (_cycle, status) => { retired.push(status); },
  });
  assert.equal(result.status, "succeeded");
  assert.equal(pushes, 0);
  assert.deepEqual(retired, ["succeeded"]);
});

test("invoice calculations persist line and header discounts, net and tax", () => {
  const calculated = calculateInboundInvoice({ DiscountPercent: 10, VatSum: 3.42, DocTotal: 20.52 }, [
    { Quantity: 2, UnitPrice: 10, DiscountPercent: 5 },
  ]);
  assert.equal(calculated.lines[0].discount.toFixed(2), "2.90");
  assert.equal(calculated.lines[0].net.toFixed(2), "17.10");
  assert.equal(calculated.discountAmount.toFixed(2), "2.90");
  assert.throws(() => calculateInboundInvoice({ VatSum: 0, DocTotal: 99 }, [{ Quantity: 1, UnitPrice: 2 }]), /INVOICE_TOTAL_MISMATCH/);
  const projected = calculateInboundInvoice({ DiscountPercent: 10, TotalDiscount: 1, VatSum: 0, RoundingDiffAmount: 0.05, DocTotal: 9.05 }, [{ Quantity: 1, UnitPrice: 10 }]);
  assert.equal(projected.discountAmount, 1);
  assert.equal(projected.total, 9.05);
});