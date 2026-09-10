      case "surcharge_pct":        engine.setSurchargePct(value); break;
      case "line_surcharge_pct":   engine.setLineSurcharge(value); break;
    }
  }

  // ── Payment complete ──────────────────────────────────────────────────────
  async function handlePaymentComplete(result: PaymentResult) {
    try {
      // Capture lines before completeOrder clears the order
      const saleLines = [...engine.lines];
      const saleOrder = { ...engine.order };

      const method = result.tenders.length === 1
        ? result.tenders[0].method
        : "split";

      // Gateway auth code from the approved card tender (if any)
      const cardTender = result.tenders.find((t) =>
        t.method.startsWith("card_") && t.approved
      );
      const paymentRef = cardTender?.reference;
      if (cardTender && !paymentRef?.trim()) {
        throw new Error("Approved card payment has no terminal reference. Verify the payment before completing the order.");
      }

      // Publish "payment" mode to customer display before completing
      if (hw.config?.customer_display_enabled && cdStoreRef.current) {
        await cdStoreRef.current.set("state", {
          mode: "payment",
          items: saleLines.map((l) => ({ description: l.description, qty: l.qty, unit_price: l.unit_price, line_total: l.line_total })),
          subtotal: saleOrder.subtotal, vat: saleOrder.vat_amount,
          total: saleOrder.total, payment_method: method,
          amount_tendered: result.totalTendered,
          change_due: result.changeDue,
          store_name: config.terminal_name,
        }).catch(() => {});
        await cdStoreRef.current.save().catch(() => {});
      }

      const completedOrder = await engine.completeOrder(
        method, result.totalTendered,
        session.cashier_id, session.cashier_name,
        paymentRef
      );
      setDialog(null);
      sync.triggerOutboxFlush();

      // Settle any validated voucher / credit-note tenders against their DB balance.
      // (Free-text/legacy voucher tenders with no settleId are skipped — nothing to redeem.)
      for (const tender of result.tenders) {
        if (tender.method === "voucher" && tender.settleId) {
          await redeemGiftVoucher(tender.settleId, tender.amount).catch((err) => {
            console.error("Failed to redeem gift voucher", tender.settleId, err);
          });
        } else if (tender.method === "credit_note" && tender.settleId) {
          await redeemCreditNote(tender.settleId, tender.amount).catch((err) => {
            console.error("Failed to redeem credit note", tender.settleId, err);
          });
        }
      }

      // Publish "complete" mode to customer display after order finalised
      if (hw.config?.customer_display_enabled && cdStoreRef.current) {
        await cdStoreRef.current.set("state", {
          mode: "complete",
          items: [], subtotal: 0, vat: 0,
          total: completedOrder.total,
          payment_method: method,
          change_due: result.changeDue,
          store_name: config.terminal_name,
        }).catch(() => {});
        await cdStoreRef.current.save().catch(() => {});
      }

      // Record sale in the current shift (updates shift totals for X/Z reports)
      if (shift.isShiftOpen) {
        await shift.recordSale(completedOrder.total, method).catch(() => {});
      }

      const rc = receiptConfigRef.current ?? {
        ...DEFAULT_RECEIPT_CONFIG,
        footer_lines: [
          receiptLanguage === "el"
            ? "Ευχαριστούμε για την προτίμησή σας!"
            : "Thank you for your purchase!",
        ],
      };
      const receiptLines = buildReceiptLines(rc, {
        terminalCode: config.terminal_code, cashierName: session.cashier_name,
        order: completedOrder, lines: saleLines, paymentMethod: method, paymentRef,
        totalTendered: result.totalTendered, changeDue: result.changeDue,
        language: receiptLanguage, currency: formatCurrency, width: hw.config?.printer_columns,
      });

      // Store for re-print from success overlay
      lastReceiptPrinterCallback.current = async () => { await hw.printReceipt(receiptLines); };

      // Auto-print if printer available
      if (hw.printerStatus === "online" && hw.config?.printer_enabled) {
        await hw.printReceipt(receiptLines);
      }

      // Open cash drawer for cash payments
      const hasCash = result.tenders.some((t) => t.method === "cash");
      if (hasCash && hw.config?.drawer_enabled) {
        await hw.openDrawer();
      }

      // Show success overlay
      setPaymentSuccess({
        total: completedOrder.total,
        method,
        changeDue: result.changeDue,
        tendered: result.totalTendered,
        orderNumber: completedOrder.order_number ?? "",
        cardRef: paymentRef,
      });
    } catch (e) {
      console.error("Payment complete failed:", e);
    }
  }

  // ── Special modes ─────────────────────────────────────────────────────────

  if (mode === "sco") {
    return (
      <SelfCheckout
        cashierId={session.cashier_id}
        cashierName={session.cashier_name}
        terminalPrefix={config.terminal_code}
        onExit={() => setMode("sell")}
      />
    );
  }

  if (mode === "shift") {
    return (
      <ShiftManager
        cashierId={session.cashier_id}
        cashierName={session.cashier_name}
        terminalName={config.terminal_name}
        onPrint={(lines) => hw.printReceipt(lines)}
        onClose={() => setMode("sell")}
      />
    );
  }

  if (mode === "fallback") {
    return <FallbackRules onClose={() => setMode("sell")} />;
  }

  if (mode === "receipt_design") {
    return (
      <ReceiptDesigner
        terminalCode={config.terminal_code}
        onClose={() => {
          import("../lib/db").then(({ getReceiptConfig }) =>
            getReceiptConfig().then((cfg) => { receiptConfigRef.current = cfg; }).catch(() => {})
          );
          setMode("sell");
        }}
      />
    );
  }

  if (mode === "barcode_config") {
    return (
      <BarcodeConfig
        onClose={() => {
          import("../lib/db").then(({ getBarcodeConfig }) =>
            getBarcodeConfig().then((cfg) => { barcodeConfigRef.current = cfg; }).catch(() => {})
          );
          setMode("sell");
        }}
      />
    );
  }

  if (mode === "hardware_config") {
    return <HardwareConfigPage onClose={() => setMode("sell")} />;
  }

  if (mode === "sco_monitor") {
    return <ScoMonitor config={config} onClose={() => setMode("sell")} />;
  }

  const selectedLine = engine.lines.find((l) => l.id === engine.selectedLineId);
  const hasLines = engine.lines.length > 0;

  const isLightTheme = posTheme === "light";

  return (
    <div className={`flex flex-col h-screen overflow-hidden ${isLightTheme ? "bg-slate-100" : "bg-gray-950"}`}>
      {/* Sync header */}
      <SyncHeader
        config={config}
        session={session}
        syncStatus={sync.status}
        peripheralHealth={sync.peripheralHealth}
        notifications={sync.notifications}
        theme={posTheme}
        onToggleTheme={toggleTheme}
        onSyncCatalog={sync.triggerCatalogSync}
        onLogout={onLogout}
        printerStatus={hw.printerStatus}
        printerEnabled={!!hw.config?.printer_enabled}
      />

      {/* Category nav */}
      <CategoryNav
        categories={categories}
        selectedId={selectedCategory}
        onSelect={setSelectedCategory}
        theme={posTheme}
      />

      {/* Scale bar — shown when scale is connected */}
      {hw.config?.scale_enabled && (
        <ScaleBar
          weight={hw.scaleWeight}
          error={hw.scaleError}
          onTare={hw.tare}
        />
      )}

      <div className={`flex items-center gap-3 px-4 py-1.5 text-xs border-b flex-shrink-0 ${isLightTheme ? "bg-white border-slate-200 text-slate-600" : "bg-gray-900 border-gray-800 text-gray-400"}`} data-testid="pos-context-strip">
        <span className="font-semibold text-burgundy-500">{engine.order.customer_id ? "Member" : "Walk-in"}</span>
        {engine.order.customer_id && <span className="font-mono">{engine.order.customer_id}</span>}
        <span className={isLightTheme ? "text-slate-300" : "text-gray-700"}>|</span>
        <span>Price level <strong className={isLightTheme ? "text-slate-800" : "text-gray-200"}>{engine.order.price_level}</strong></span>
        <span className="ml-auto hidden sm:inline">{config.location_name} · {config.terminal_name}</span>
      </div>

      {/* Main content: journal + corrections/numpad panel + grid (journal → keypad → items) */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        <OrderTicket
          order={engine.order}
          lines={engine.lines}
          selectedLineId={engine.selectedLineId}
          onSelectLine={engine.selectLine}
          onAddQty={engine.addQty}
          onSubQty={engine.subtractQty}
          onRemoveLine={engine.removeLine}
          onVoidLine={() => perms.requestAction("void_line", engine.voidLine)}
          onPay={() => setDialog("payment")}
          onClear={engine.clearOrder}
          theme={posTheme}
          appliedPromos={appliedPromos}
          totalSavings={totalSavings}
        />

        <CorrectionsPanel
          selectedLine={selectedLine ?? null}
          hasLines={hasLines}
          theme={posTheme}
          onSetQty={(qty) => engine.setQty(qty)}
          onSetPriceOverride={(price) => perms.requestAction("price_override", () => engine.setPriceOverride(price))}
          onSetLineDiscountPct={(pct) => perms.requestAction("discount", () => engine.setLinePct(pct))}
          onRemoveLine={engine.removeLine}
          onVoidLine={() => perms.requestAction("void_line", engine.voidLine)}
          onHold={engine.holdOrder}
          onRecall={() => setDialog("recall")}
          onRepeatLast={engine.repeatLastItem}
          onVoidOrder={() => perms.requestAction("void_order", () => engine.voidOrder())}
          onLineNote={() => setDialog("note_line")}
          onPromoCode={() => setDialog("promo")}
          onRemoveDiscount={engine.removeDiscount}
          onDeptSale={() => setDialog("dept_sale")}
          onPriceCheck={() => setDialog("price_check")}
        />

        <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
          <LayoutGrid
            buttons={layoutButtons}
            products={productsForLayout}
            columns={activeColumns}
            rows={activeRows}
            priceLevel={engine.order.price_level}
            colorTheme={isLightTheme ? "light" : "standard"}
            onItemButton={handleAddProduct}
            onCategoryButton={setSelectedCategory}
            onActionButton={handleAction}
          />
        </div>
      </div>

      {/* Action bar — with Phase 3 buttons */}
      <ActionBar
        hasLines={hasLines}
        hasSelectedLine={!!selectedLine && !selectedLine.voided}
        theme={posTheme}
        onHold={engine.holdOrder}
        onRecall={() => setDialog("recall")}
        onVoidOrder={() => perms.requestAction("void_order", () => engine.voidOrder())}
        onLineNote={() => setDialog("note_line")}
        onOrderNote={() => setDialog("note_order")}
        onRepeatLast={engine.repeatLastItem}
        onNumpad={(m) => { setNumpadModeState(m); setDialog("numpad"); }}
        onPromoCode={() => setDialog("promo")}
        onFallbackRules={() => setMode("fallback")}
        onBarcodeConfig={() => setMode("barcode_config")}
        onReceiptDesign={() => setMode("receipt_design")}
        onRemoveDiscount={engine.removeDiscount}
        onRefund={() => setDialog("refund")}
        onShift={() => setMode("shift")}
        onSco={() => setMode("sco")}
        onStockTransfer={() => setDialog("stock_transfer")}
        onManual={() => {
          const base = config.server_url.replace(/\/$/, "");
          openShell(`${base}/api/manual`).catch(() => {
            window.open(`${base}/api/manual`, "_blank", "noopener,noreferrer");
          });
        }}
        onBarcodeEntry={() => setDialog("manual_barcode")}
        onReviewTransactions={() => setDialog("transaction_review")}
        onVatSale={(vatRate) => {
          const hasVatCategory = categories.some((category) => Math.abs(category.vat_rate - vatRate) < 0.01);
          if (!hasVatCategory) {
            alert(`No active ${vatRate}% VAT department is configured. Add or update a category before using this key.`);
            return;
          }
          setDeptSaleVatRate(vatRate);
          setDialog("dept_sale");
        }}
        onProduce={() => setDialog("produce")}
        onBottleReturn={() => setDialog("bottle_return")}
        onCoupon={() => setDialog("coupon")}
        onClickCollect={() => {
          invoke<Array<{id:string;order_number?:string;payload:string;created_at?:string}>>("get_click_collect_orders")
            .then((orders) => { setCcOrders(orders); setDialog("click_collect"); })
            .catch(() => { setCcOrders([]); setDialog("click_collect"); });
        }}
        onScoMonitor={() => setMode("sco_monitor")}
        onHardwareConfig={() => setMode("hardware_config")}
      />

      {/* ── Dialogs ── */}

      {dialog === "manual_barcode" && (
        <ManualBarcodeDialog onSubmit={processBarcode} onClose={() => setDialog(null)} />
      )}

      {/* Full PaymentDialog (Phase 3) — replaces the simple inline PayDialog */}
      <PaymentDialog
        open={dialog === "payment"}
        orderTotal={engine.order.total}
        initialTab={paymentInitialTab}
        loyaltyPoints={selectedCustomer?.loyaltyPoints ?? 0}
        onComplete={handlePaymentComplete}
        onCancel={() => setDialog(null)}
      />

      {/* RefundDialog (Phase 3) */}
      <RefundDialog
        open={dialog === "refund"}
        cashierId={session.cashier_id}
        cashierName={session.cashier_name}
        terminalCode={config.terminal_code}
        printerColumns={hw.config?.printer_columns}
        onPrint={
          hw.printerStatus === "online" && hw.config?.printer_enabled
            ? (lines) => hw.printReceipt(lines)
            : undefined
        }
        onComplete={(refundTotal, method) => {
          setDialog(null);
          sync.triggerOutboxFlush();
          // Open drawer for cash refunds
          if (method === "cash" && hw.config?.drawer_enabled) {
            hw.openDrawer();
          }
        }}
        onCancel={() => setDialog(null)}
      />

      {dialog === "numpad" && (
        <Numpad
          mode={numpadMode}
          currentValue={numpadMode === "qty" ? selectedLine?.qty : undefined}
          onConfirm={handleNumpadConfirm}
          onClose={() => setDialog(null)}
          theme={posTheme}
        />
      )}

      {dialog === "price_check" && (
        <PriceCheckDialog
          priceLevel={engine.order.price_level}
          theme={posTheme}
          onSearch={(query) => getProducts(undefined, query)}
          onLookupBarcode={(barcode) => getProductByBarcode(barcode)}
          onGetStockByLocation={(itemId) => getStockByLocation(itemId)}
          onClose={() => setDialog(null)}
        />
      )}

      {dialog === "customer_lookup" && (
        <CustomerLookupDialog
          serverUrl={config.server_url}
          terminalCode={config.terminal_code}
          onSelect={(customer) => {
            setSelectedCustomer(customer);
            engine.setCustomer(customer.id);
          }}
          onClose={() => setDialog(null)}
        />
      )}

      {dialog === "stock_transfer" && (
        <StockTransferDialog
          theme={posTheme}
          cashierName={session.cashier_name}
          onSearch={(query) => getProducts(undefined, query)}
          onLookupBarcode={(barcode) => getProductByBarcode(barcode)}
          onGetLocations={() => getPosLocations()}
          onSubmit={(toLocationId, cashierName, items) => createStockTransfer(toLocationId, cashierName, items)}
          onClose={() => setDialog(null)}
        />
      )}

      {dialog === "note_line" && (
        <NoteDialog
          title="Line Note"
          initial={selectedLine?.note}
          onConfirm={engine.addLineNote}
          onClose={() => setDialog(null)}
        />
      )}

      {dialog === "note_order" && (
        <NoteDialog
          title="Order Note"
          initial={engine.order.note}
          onConfirm={engine.addOrderNote}
          onClose={() => setDialog(null)}
        />
      )}

      {dialog === "promo" && (
        <PromoDialog
          onApply={engine.applyPromoCode}
          onClose={() => setDialog(null)}
        />
      )}

      {dialog === "recall" && (
        <RecallDialog
          onRecall={(heldOrder, heldLines) => { engine.recallOrder(heldOrder, heldLines); }}
          onClose={() => setDialog(null)}
        />
      )}

      {dialog === "cash_dialog" && (
        <CashDialog
          mode={cashDialogMode}
          onConfirm={(amount, note) => {
            if (cashDialogMode === "cash_in") shift.addCashIn(amount, note);
            else if (cashDialogMode === "cash_out") shift.addCashOut(amount, note);
            else shift.addCashOut(amount, note ? `Petty cash: ${note}` : "Petty cash");
          }}
          onClose={() => setDialog(null)}
        />
      )}

      {dialog === "dept_sale" && (
        <DeptSaleDialog
          categories={deptSaleVatRate == null
            ? categories
            : categories.filter((category) => Math.abs(category.vat_rate - deptSaleVatRate) < 0.01)}
          onConfirm={(category, amount) => engine.addDepartmentLine(category, amount)}
          onClose={() => { setDeptSaleVatRate(null); setDialog(null); }}
        />
      )}

      <TransactionReviewDialog
        open={dialog === "transaction_review"}
        onClose={() => setDialog(null)}
      />

      {dialog === "issue_credit_note" && (
        <IssueCreditNoteDialog
          onIssue={async (amount, reason) => {
            const note = await issueCreditNote(amount, session.cashier_id, session.cashier_name, {
              orderNumber: engine.order.order_number || undefined,
              reason: reason || undefined,
            });
            sync.triggerOutboxFlush();
            return { code: note.code };
          }}
          onClose={() => setDialog(null)}
        />
      )}

      {dialog === "issue_voucher" && (
        <IssueVoucherDialog
          onIssue={async (amount) => {
            const voucher = await issueGiftVoucher(amount, session.cashier_id, session.cashier_name);
            sync.triggerOutboxFlush();
            return { code: voucher.code };
          }}
          onClose={() => setDialog(null)}
        />
      )}

      {/* Age verification — auto-shown when a restricted item is scanned */}
      {ageCheckPending && (
        <AgeVerificationDialog
          open={!!ageCheckPending}
          productName={ageCheckPending.product.name}
          minAge={(ageCheckPending.product as any).min_age ?? 18}
          onApprove={() => {
            resolveAgeCheck(ageCheckPending, true, engine.addProduct, (action, product) => {
              invoke("write_audit", {
                cashierId: session.cashier_id, cashierName: session.cashier_name,
                action, entity: "sale", detail: product.name,
              }).catch(() => {});
            });
            setAgeCheckPending(null);
          }}
          onReject={() => {
            resolveAgeCheck(ageCheckPending, false, engine.addProduct, (action, product) => {
              invoke("write_audit", {
                cashierId: session.cashier_id, cashierName: session.cashier_name,
                action, entity: "sale", detail: product.name,
              }).catch(() => {});
            });
            setAgeCheckPending(null);
          }}
        />
      )}

      {/* Produce grid dialog */}
      {dialog === "produce" && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
          <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-2xl mx-4 flex flex-col max-h-[90vh]">
            <div className="flex items-center justify-between px-5 py-4 border-b">
              <h2 className="font-semibold text-lg">Produce / PLU</h2>
              <button
                onClick={() => setDialog(null)}
                className="text-gray-400 hover:text-gray-700 rounded-full p-1"
                data-testid="btn-close-produce"
              >✕</button>
            </div>
            <div className="flex-1 min-h-0 p-4 overflow-hidden">
              <ProduceGrid
                onAdd={(product, qty) => {
                  handleAddProduct(product, qty);
                  setDialog(null);
                }}
                currentWeightKg={hw.config?.scale_enabled ? (hw.scaleWeight?.kg ?? undefined) : undefined}
                onRequestWeigh={hw.config?.scale_enabled ? () => hw.startWeightPolling(200) : undefined}
              />
            </div>
          </div>
        </div>
      )}

      {/* Bottle return dialog */}
      {dialog === "bottle_return" && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
          <div className="bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-sm p-6 shadow-2xl">
            <h2 className="text-white font-semibold mb-4">Bottle / Container Return</h2>
            <BottleReturnDialogContent
              products={products}
              onConfirm={(name, amount) => {
                const depositProduct: Product = {
                  id: `bottle-return-${Date.now()}`,
                  server_id: null,
                  name,
                  sku: "RETURN",
                  barcode: null,
                  price1: -Math.abs(amount),
                  price2: -Math.abs(amount),
                  price3: -Math.abs(amount),
                  price4: -Math.abs(amount),
                  price5: -Math.abs(amount),
                  category_id: null,
                  vat_rate: 0,
                  active: true,
                  stock_quantity: 999,
                  unit: "pcs",
                  has_variants: false,
                } as unknown as Product;
                engine.addProduct(depositProduct, 1);
                setDialog(null);
              }}
              onClose={() => setDialog(null)}
            />
          </div>
        </div>
      )}

      {/* Coupon entry dialog */}
      {dialog === "coupon" && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
          <div className="bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-xs p-6 shadow-2xl">
            <h2 className="text-white font-semibold mb-4">Apply Coupon</h2>
            <CouponEntryContent
              onApply={async (code) => {
                const result = await multiBuy.validateCoupon(code);
                if (result.valid && result.promo) {
                  const productLinesSnap = engine.lines.filter(
                    (l) => !l.id.startsWith("multibuy-") && !l.id.startsWith("coupon-")
                  );
                  const applied = multiBuy.applyCoupon(result.promo, productLinesSnap);
                  if (applied) {
                    // Inject coupon as a real negative line so order.total is reduced
                    setAppliedCoupons((prev) => {
                      const already = prev.find((c) => c.promo_id === applied.promo_id);
                      if (already) return prev;
                      return [...prev, {
                        promo_id: applied.promo_id,
                        description: applied.description,
                        discount_amount: applied.discount_amount,
                      }];
                    });
                    return { success: true, message: `Saved €${applied.discount_amount.toFixed(2)}` };
                  }
                }
                return { success: false, message: result.message ?? "Invalid or expired coupon" };
              }}
              onClose={() => setDialog(null)}
            />
          </div>
        </div>
      )}

      {/* Click & Collect queue */}
      {dialog === "click_collect" && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
          <div className="bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-lg p-6 shadow-2xl max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-white font-semibold">Click & Collect Queue</h2>
              <button onClick={() => setDialog(null)} className="text-gray-400 hover:text-white">✕</button>
            </div>
            <form
              className="flex gap-2 mb-4"
              onSubmit={async (e) => {
                e.preventDefault();
                const orderNumber = ccSearch.trim().replace(/^#/, "");
                if (!orderNumber || ccSearching) return;
                setCcSearching(true);
                setCcSearchError("");
                try {
                  const found = await invoke<{ order_number: string; status: string; lines: any[] }>(
                    "find_click_collect_order",
                    { orderNumber }
                  );
                  if (found.status === "completed") {
                    setCcSearchError("This order has already been collected.");
                    return;
                  }
                  if (!found.lines?.length) {
                    setCcSearchError("This order has no items to load.");
                    return;
                  }
                  await invoke("mark_click_collect_order_collected", {
                    orderNumber: found.order_number || orderNumber,
                  });
                  loadClickCollectLines(found.lines);
                  setDialog(null);
                  setCcSearch("");
                } catch (error) {
                  setCcSearchError(String(error));
                } finally {
                  setCcSearching(false);
                }
              }}
            >
              <input
                value={ccSearch}
                onChange={(e) => { setCcSearch(e.target.value); setCcSearchError(""); }}
                placeholder="Search by order number"
                aria-label="Search by order number"
                className="flex-1 bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-burgundy-500"
                data-testid="input-click-collect-order-number"
              />
              <button
                type="submit"
                disabled={!ccSearch.trim() || ccSearching}
                className="px-4 py-2 bg-burgundy-700 hover:bg-burgundy-600 text-white rounded-lg text-sm font-semibold disabled:opacity-40"
                data-testid="button-click-collect-search"
              >
                {ccSearching ? "Searching…" : "Search"}
              </button>
            </form>
            {ccSearchError && <p className="text-red-400 text-sm mb-4" role="alert">{ccSearchError}</p>}
            {ccOrders.length === 0 ? (
              <div className="text-center text-gray-500 py-8">No pending pickup orders</div>
            ) : (
              <div className="flex-1 overflow-y-auto space-y-3 min-h-0">
                {ccOrders.map((order) => {
                  let parsed: any = {};
                  try { parsed = JSON.parse(order.payload); } catch {}
                  const lines: any[] = parsed.lines ?? [];
                  const total = lines.reduce((s: number, l: any) => s + (l.line_total ?? 0), 0);
                  return (
                    <div key={order.id} className="bg-gray-800 rounded-xl p-4 space-y-2">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-white font-medium">Order #{parsed.order_number ?? order.order_number ?? "—"}</p>
                          <p className="text-gray-500 text-xs">{parsed.customer_name ?? "Walk-in"}</p>
                        </div>
                        <p className="text-burgundy-400 font-bold">€{total.toFixed(2)}</p>
                      </div>
                      <div className="text-xs text-gray-500 space-y-0.5">
                        {lines.slice(0, 3).map((l: any, i: number) => (
                          <div key={i}>{l.qty ?? 1}× {l.description ?? l.name}</div>
                        ))}
                        {lines.length > 3 && <div>+{lines.length - 3} more items</div>}
                      </div>
                      <div className="flex gap-2 pt-1">
                        <button
                          onClick={async () => {
                            setCcSearchError("");
                            try {
                              const orderNumber = parsed.order_number ?? order.order_number;
                              if (!orderNumber) throw new Error("This pickup has no order number.");
                              await invoke("mark_click_collect_order_collected", { orderNumber });
                              loadClickCollectLines(lines);
                              await invoke("mark_inbox_processed", { id: order.id }).catch(() => {});
                              setDialog(null);
                            } catch (error) {
                              setCcSearchError(String(error));
                              setCcOrders((prev) => prev.filter((o) => o.id !== order.id));
                            }
                          }}
                          className="flex-1 py-2 bg-green-700 hover:bg-green-600 text-white rounded-lg text-sm font-semibold"
                          data-testid={`cc-accept-${order.id}`}
                        >Accept</button>
                        <button
                          onClick={async () => {
                            await invoke("mark_inbox_processed", { id: order.id }).catch(() => {});
                            setCcOrders((prev) => prev.filter((o) => o.id !== order.id));
                          }}
                          className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded-lg text-sm"
                          data-testid={`cc-reject-${order.id}`}
                        >Reject</button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Permission PIN prompt */}
      {perms.pinPromptAction && perms.pinPromptRole && (
        <PinPrompt
          action={perms.pinPromptAction}
          requiredRole={perms.pinPromptRole}
          onGranted={perms.onPinGranted}
          onDenied={perms.onPinDenied}
        />
      )}

      {/* Customer display — reads from Tauri store; rendered when enabled */}
      {hw.config?.customer_display_enabled && <CustomerDisplay />}

      {/* Payment success overlay */}
      {paymentSuccess && (
        <PaymentSuccessOverlay
          result={paymentSuccess}
          onNewOrder={() => setPaymentSuccess(null)}
          onPrint={() => {
            lastReceiptPrinterCallback.current?.();
          }}
        />
      )}
    </div>
  );
}

// ── Bottle return inline content ───────────────────────────────────────────────

function BottleReturnDialogContent({
  products,
  onConfirm,
  onClose,
}: {
  products: Product[];
  onConfirm: (name: string, amount: number) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [amount, setAmount] = useState("");
  const [selectedName, setSelectedName] = useState("");

  const filtered = products.filter(
    (p) => query && (p.name.toLowerCase().includes(query.toLowerCase()) || p.sku?.includes(query))
  ).slice(0, 8);

  const depositAmount = parseFloat(amount) || 0;

  return (
    <>
      <label className="text-gray-400 text-xs mb-1 block">Search item (optional)</label>
      <input
        type="text"
        className="w-full bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2.5 text-sm mb-2 focus:outline-none focus:ring-2 focus:ring-burgundy-500"
        placeholder="Item name or SKU…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        data-testid="input-bottle-search"
      />
      {filtered.length > 0 && (
        <div className="mb-3 space-y-1 max-h-32 overflow-y-auto">
          {filtered.map((p) => {
            const dep = (p as any).deposit_amount as number | undefined;
            return (
              <button
                key={p.id}
                className="w-full flex justify-between text-left bg-gray-800 hover:bg-gray-700 rounded-lg px-3 py-2 text-sm"
                onClick={() => {
                  setSelectedName(`Deposit - ${p.name}`);
                  if (dep && dep > 0) setAmount(dep.toString());
                  setQuery("");
                }}
              >
                <span className="text-gray-200 truncate">{p.name}</span>
                {dep && dep > 0 && <span className="text-burgundy-400 ml-2 shrink-0">€{dep.toFixed(2)}</span>}
              </button>
            );
          })}
        </div>
      )}
      <label className="text-gray-400 text-xs mb-1 block">Return description</label>
      <input
        type="text"
        className="w-full bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2.5 text-sm mb-3 focus:outline-none focus:ring-2 focus:ring-burgundy-500"
        placeholder="e.g. Bottle return — Cola 330ml"
        value={selectedName}
        onChange={(e) => setSelectedName(e.target.value)}
        data-testid="input-bottle-name"
      />
      <label className="text-gray-400 text-xs mb-1 block">Deposit amount (€)</label>
      <input
        type="number"
        step="0.01"
        className="w-full bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2.5 text-sm mb-4 focus:outline-none focus:ring-2 focus:ring-burgundy-500"
        placeholder="0.15"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        data-testid="input-bottle-amount"
      />
      <div className="flex gap-3">
        <button onClick={onClose} className="flex-1 py-2.5 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg text-sm">Cancel</button>
        <button
          onClick={() => onConfirm(selectedName || "Bottle return", depositAmount)}
          disabled={depositAmount <= 0}
          className="flex-1 py-2.5 bg-burgundy-700 hover:bg-burgundy-600 text-white rounded-lg text-sm font-semibold disabled:opacity-40"
          data-testid="btn-confirm-bottle-return"
        >
          Add Refund Line
        </button>
      </div>
    </>
  );
}

// ── Coupon entry inline content ────────────────────────────────────────────────

function CouponEntryContent({
  onApply,
  onClose,
}: {
  onApply: (code: string) => Promise<{ success: boolean; message: string }>;
  onClose: () => void;
}) {
  const [code, setCode] = useState("");
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleApply() {
    if (!code.trim() || busy) return;
    setBusy(true);
    const r = await onApply(code.trim().toUpperCase());
    setResult(r);
    setBusy(false);
    if (r.success) setTimeout(onClose, 1200);
  }

  return (
    <>
      <input
        type="text"
        value={code}
        onChange={(e) => { setCode(e.target.value.toUpperCase()); setResult(null); }}
        placeholder="Enter coupon code"
        className="w-full bg-gray-800 border border-gray-700 text-white rounded-lg px-4 py-3 text-sm font-mono uppercase tracking-widest focus:outline-none focus:ring-2 focus:ring-burgundy-500 placeholder:text-gray-600 mb-2"
        data-testid="input-coupon-code"
        onKeyDown={(e) => e.key === "Enter" && handleApply()}
        autoFocus
      />
      {result && (
        <p className={`text-sm mb-3 ${result.success ? "text-green-400" : "text-red-400"}`}>{result.message}</p>
      )}
      <div className="flex gap-3 mt-2">
        <button onClick={onClose} className="flex-1 py-2.5 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg text-sm">Cancel</button>
        <button
          onClick={handleApply}
          disabled={!code.trim() || busy}
          className="flex-1 py-2.5 bg-burgundy-700 hover:bg-burgundy-600 text-white rounded-lg text-sm font-semibold disabled:opacity-40"
          data-testid="btn-apply-coupon"
        >
          {busy ? "Checking…" : "Apply"}
        </button>
      </div>
    </>
  );
}
