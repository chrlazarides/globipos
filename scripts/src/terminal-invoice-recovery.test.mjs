import assert from "node:assert/strict";
import { chromium } from "playwright";

// UI fault injection only; real checkout/authorization is covered separately
// by pos-invoice.test.ts. This never bypasses or changes application auth.
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || "/repl/tools/bin/chromium",
  headless: true,
  args: ["--no-sandbox"],
});
try {
  const page = await browser.newPage();
  const requests = [];
  const quote = {
    customer: { id: "fixture-customer", name: "Recovery fixture", code: "FIXTURE" },
    credit: { approvalStatus: "approved", limitCents: 10000, balanceCents: 0, availableCents: 10000,
      paymentTerms: "credit_30", overdueCents: 0, hasOverdue: false },
    lines: [{ itemId: "fixture-item", variantId: null, description: "Fixture item", quantity: 1,
      saleUnit: "pc", unitPrice: 8.4, discountPercent: 0, totalCents: 840, vatCents: 160, vatRate: 19 }],
    subtotalCents: 840, vatCents: 160, totalCents: 1000, quoteHash: "a".repeat(64),
  };
  await page.route("**/api/pos/customer-invoices/**", async route => {
    const path = new URL(route.request().url()).pathname;
    const json = data => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(data) });
    if (path.endsWith("/customers")) return json({ customers: [quote.customer] });
    if (path.endsWith("/quote")) return json(quote);
    if (path.endsWith("/checkout")) {
      const payload = route.request().postDataJSON();
      requests.push(payload);
      if (requests.length === 1) return route.abort("failed");
      if (requests.length === 2) return route.fulfill({
        status: 401, contentType: "application/json", body: JSON.stringify({ message: "Synthetic authentication failure" }),
      });
      return json({
        orderId: payload.orderId, orderNumber: "POS-INV-FIXTURE", invoiceId: "fixture-invoice",
        invoiceNumber: "INV-FIXTURE", totalCents: 1000, changeDueCents: 0,
        paymentMethod: payload.paymentMethod, deduplicated: true,
      });
    }
    throw new Error(`Unexpected invoice request: ${path}`);
  });
  const mount = async emptyBasket => page.evaluate(async ({ emptyBasket }) => {
    const componentPath = "/terminal/src/components/CustomerInvoiceDialog.tsx";
    const componentSource = await (await fetch(componentPath)).text();
    const mainSource = await (await fetch("/terminal/src/main.tsx")).text();
    const reactUrl = componentSource.match(/from\s+["']([^"']+\/react\.js[^"']*)["']/)?.[1];
    const domUrl = mainSource.match(/from\s+["']([^"']+\/react-dom_client\.js[^"']*)["']/)?.[1];
    if (!reactUrl || !domUrl) throw new Error("Could not resolve the app's own React modules");
    const React = await import(reactUrl);
    const dom = await import(domUrl);
    const createRoot = dom.createRoot ?? dom.default.createRoot;
    const { CustomerInvoiceDialog } = await import(componentPath);
    const element = document.createElement("div");
    document.body.appendChild(element);
    window.fixtureCompletions = 0;
    createRoot(element).render(React.default.createElement(CustomerInvoiceDialog, {
      mode: "retail", config: { server_url: location.origin, terminal_code: "fixture",
        voucher_device_key: "synthetic-device-key" },
      cashierId: "fixture-cashier", lines: emptyBasket ? [] : [{ itemId: "fixture-item", quantity: 1 }],
      onClose: () => {},
      onCompleted: async () => {
        window.fixtureCompletions++;
        if (window.fixtureCompletions === 1) throw new Error("Synthetic local completion failure");
      },
    }));
  }, { emptyBasket });
  const saved = () => page.evaluate(() => {
    const key = Object.keys(localStorage).find(k => k.startsWith("globipos:pending-invoice:"));
    return key ? localStorage.getItem(key) : null;
  });

  await page.goto("http://127.0.0.1:80/terminal/");
  await mount(false);
  await page.getByTestId("input-invoice-pin").fill("482961");
  await page.getByTestId("input-invoice-customer-search").fill("Recovery");
  await page.getByTestId("button-invoice-search").click();
  await page.getByTestId("button-invoice-customer-fixture-customer").click();
  await page.getByTestId("checkbox-invoice-confirm-quote").check();
  await page.getByTestId("button-invoice-checkout").click();
  await page.getByTestId("text-invoice-error").filter({ hasText: "Retry" }).waitFor();
  const first = JSON.parse(await saved());
  assert.equal(first.request.amountTenderedCents, 0);
  assert.equal("pin" in first.request, false);
  assert.ok(!(await saved()).includes("synthetic-device-key"));

  await page.reload();
  await mount(true);
  await page.getByTestId("text-invoice-error").filter({ hasText: "restored" }).waitFor();
  assert.equal(await page.getByTestId("button-invoice-method-card").isDisabled(), true);
  assert.equal(await page.getByTestId("button-invoice-checkout").isDisabled(), true);
  await page.getByTestId("input-invoice-confirm-pin").fill("482961");
  await page.getByTestId("checkbox-invoice-confirm-quote").check();
  await page.getByTestId("button-invoice-checkout").click();
  await page.getByTestId("text-invoice-error").filter({ hasText: "Synthetic authentication" }).waitFor();
  assert.equal(JSON.parse(await saved()).request.orderId, first.request.orderId);
  await page.getByTestId("button-invoice-checkout").click();
  await page.getByTestId("invoice-success").waitFor();
  await page.getByTestId("button-invoice-retry-completion").waitFor();
  assert.ok(await saved(), "Failed local completion must retain recovery");
  await page.getByTestId("button-invoice-retry-completion").click();
  await page.waitForFunction(() => !Object.keys(localStorage).some(k => k.startsWith("globipos:pending-invoice:")));
  assert.equal(requests.length, 3, "Local completion retry must not issue an invoice again");
  assert.ok(requests.every(r => r.orderId === first.request.orderId && r.amountTenderedCents === 0));
  assert.equal(await page.evaluate(() => window.fixtureCompletions), 2);
  console.log("Terminal invoice UI: reload recovery, frozen payment, same-key auth retry and local completion retry passed.");
} finally {
  await browser.close();
}