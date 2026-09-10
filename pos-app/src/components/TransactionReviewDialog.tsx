import { useEffect, useMemo, useState } from "react";
import { SearchIcon, XIcon } from "lucide-react";
import { getOrderLines, getRecentOrders } from "../lib/db";
import { formatCurrency } from "../lib/pricing";
import type { Order, OrderLine } from "../types";

interface Props {
  open: boolean;
  onClose: () => void;
}

export function TransactionReviewDialog({ open, onClose }: Props) {
  const [orders, setOrders] = useState<Order[]>([]);
  const [selected, setSelected] = useState<Order | null>(null);
  const [lines, setLines] = useState<OrderLine[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setError("");
    getRecentOrders()
      .then((rows) => {
        setOrders(rows);
        if (rows.length) setSelected(rows[0]);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Could not load transactions"))
      .finally(() => setLoading(false));
  }, [open]);

  useEffect(() => {
    if (!selected) {
      setLines([]);
      return;
    }
    getOrderLines(selected.id).then(setLines).catch(() => setLines([]));
  }, [selected]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return orders;
    return orders.filter((order) =>
      order.order_number.toLowerCase().includes(needle) ||
      order.cashier_name.toLowerCase().includes(needle) ||
      (order.payment_method ?? "").toLowerCase().includes(needle)
    );
  }, [orders, query]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-3 backdrop-blur-sm">
      <div className="flex h-[min(760px,94vh)] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-gray-700 bg-gray-900 shadow-2xl">
        <div className="flex min-h-14 items-center gap-3 border-b border-gray-700 px-4">
          <h2 className="text-lg font-bold text-white">Review Transactions</h2>
          <div className="relative ml-auto w-72 max-w-[45vw]">
            <SearchIcon className="absolute left-3 top-3 h-4 w-4 text-gray-500" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Receipt, cashier or payment"
              className="h-10 w-full rounded-lg border border-gray-700 bg-gray-800 pl-9 pr-3 text-sm text-white outline-none focus:border-burgundy-500"
              data-testid="transaction-review-search"
            />
          </div>
          <button onClick={onClose} className="flex h-11 w-11 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-800 hover:text-white" aria-label="Close transaction review">
            <XIcon className="h-5 w-5" />
          </button>
        </div>

        {error && <div className="bg-red-950 px-4 py-2 text-sm text-red-300">{error}</div>}
        <div className="grid min-h-0 flex-1 grid-cols-[minmax(300px,42%)_1fr]">
          <div className="overflow-y-auto border-r border-gray-700">
            {loading && <p className="p-5 text-sm text-gray-400">Loading transactions…</p>}
            {!loading && filtered.length === 0 && <p className="p-5 text-sm text-gray-400">No completed transactions found.</p>}
            {filtered.map((order) => (
              <button
                key={order.id}
                onClick={() => setSelected(order)}
                className={`flex min-h-16 w-full items-center gap-3 border-b border-gray-800 px-4 py-3 text-left active:scale-[.99] ${selected?.id === order.id ? "bg-burgundy-950" : "hover:bg-gray-800"}`}
                data-testid={`transaction-${order.order_number}`}
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate font-semibold text-white">{order.order_number}</div>
                  <div className="text-xs text-gray-400">{new Date(order.created_at).toLocaleString()} · {order.cashier_name}</div>
                </div>
                <div className="text-right">
                  <div className="font-bold text-white">{formatCurrency(order.total)}</div>
                  <div className={order.status === "voided" ? "text-xs text-red-400" : "text-xs text-emerald-400"}>{order.status}</div>
                </div>
              </button>
            ))}
          </div>

          <div className="min-w-0 overflow-y-auto p-5">
            {!selected ? (
              <p className="text-sm text-gray-400">Select a transaction to view it.</p>
            ) : (
              <>
                <div className="mb-4 flex items-start justify-between gap-4">
                  <div>
                    <h3 className="text-xl font-bold text-white">{selected.order_number}</h3>
                    <p className="text-sm text-gray-400">{selected.payment_method || "No payment method"}{selected.payment_ref ? ` · ${selected.payment_ref}` : ""}</p>
                  </div>
                  <div className="text-right">
                    <div className="text-2xl font-bold text-white">{formatCurrency(selected.total)}</div>
                    <div className="text-xs text-gray-400">VAT {formatCurrency(selected.vat_amount)}</div>
                  </div>
                </div>
                <div className="overflow-hidden rounded-xl border border-gray-700">
                  {lines.map((line) => (
                    <div key={line.id} className="grid min-h-12 grid-cols-[1fr_auto_auto] items-center gap-4 border-b border-gray-800 px-3 py-2 last:border-b-0">
                      <div className={line.voided ? "text-gray-500 line-through" : "text-gray-200"}>{line.description}</div>
                      <div className="text-sm text-gray-400">{line.qty} × {formatCurrency(line.unit_price)}</div>
                      <div className="min-w-20 text-right font-semibold text-white">{formatCurrency(line.line_total)}</div>
                    </div>
                  ))}
                </div>
                <div className="mt-4 grid grid-cols-3 gap-3 rounded-xl bg-gray-800 p-4 text-sm">
                  <div><span className="block text-gray-500">Subtotal</span><strong className="text-white">{formatCurrency(selected.subtotal)}</strong></div>
                  <div><span className="block text-gray-500">Discount</span><strong className="text-white">{formatCurrency(selected.discount_amount)}</strong></div>
                  <div><span className="block text-gray-500">Tendered</span><strong className="text-white">{formatCurrency(selected.amount_tendered ?? selected.total)}</strong></div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}